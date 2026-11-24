import Foundation

public enum TextAnchorError: Error, Equatable, Sendable {
    case invalidRange(start: Int, end: Int, utf16Count: Int)
}

public enum TextAnchorReconciler {
    public static let defaultContextChars = 32
    public static let defaultFuzzyThreshold = 0.5
    public static let defaultMaxProximityForShortQuote = 64

    /// Creates a `TextAnchor` from UTF-16 code unit offsets `[start, end)` in `documentText`.
    public static func create(
        in documentText: String,
        start: Int,
        end: Int,
        contextChars: Int = defaultContextChars
    ) throws -> TextAnchor {
        let units = Array(documentText.utf16)
        guard start >= 0, end >= start, end <= units.count else {
            throw TextAnchorError.invalidRange(start: start, end: end, utf16Count: units.count)
        }

        let ctx = max(0, contextChars)
        let exact = decodeUTF16(units, from: start, to: end)
        let prefix: String? = (start > 0 && ctx > 0)
            ? decodeUTF16(units, from: max(0, start - ctx), to: start)
            : nil
        let suffix: String? = (end < units.count && ctx > 0)
            ? decodeUTF16(units, from: end, to: min(units.count, end + ctx))
            : nil

        return TextAnchor(
            start: start,
            end: end,
            quote: TextQuoteSelector(
                exact: exact,
                prefix: prefix?.isEmpty == false ? prefix : nil,
                suffix: suffix?.isEmpty == false ? suffix : nil
            ),
            state: .attached
        )
    }

    /// Re-resolves a `TextAnchor` against updated `documentText` using the same multi-stage
    /// algorithm as `@pixerate/conversations`'s TypeScript implementation.
    public static func reconcile(
        _ anchor: TextAnchor,
        in documentText: String,
        fuzzyThreshold: Double = defaultFuzzyThreshold,
        maxProximityForShortQuote: Int = defaultMaxProximityForShortQuote
    ) -> TextAnchor {
        let docUnits = Array(documentText.utf16)
        let exactUnits = Array(anchor.quote.exact.utf16)
        let prefixUnits = anchor.quote.prefix.map { Array($0.utf16) } ?? []
        let suffixUnits = anchor.quote.suffix.map { Array($0.utf16) } ?? []

        if exactUnits.isEmpty {
            return reconcileEmptyQuote(
                anchor: anchor,
                docUnits: docUnits,
                prefixUnits: prefixUnits,
                suffixUnits: suffixUnits
            )
        }

        let exactCandidates = findAllOccurrences(in: docUnits, needle: exactUnits)

        // 1. Fast exact-offset check
        if anchor.start >= 0,
           anchor.end <= docUnits.count,
           anchor.end - anchor.start == exactUnits.count,
           Array(docUnits[anchor.start..<anchor.end]) == exactUnits {
            let ctx = scoreContext(
                docUnits: docUnits,
                start: anchor.start,
                end: anchor.end,
                prefixUnits: prefixUnits,
                suffixUnits: suffixUnits
            )
            let hasNoContext = prefixUnits.isEmpty && suffixUnits.isEmpty
            if exactCandidates.count <= 1 || ctx.prefixExact || ctx.suffixExact || hasNoContext {
                return withAttachedBounds(anchor, start: anchor.start, end: anchor.end)
            }
        }

        // 2. Exact quote search scored by prefix/suffix context and offset proximity
        if !exactCandidates.isEmpty {
            var bestStart = -1
            var bestScore = -1.0
            var bestDist = Int.max

            for idx in exactCandidates {
                let candEnd = idx + exactUnits.count
                let ctx = scoreContext(
                    docUnits: docUnits,
                    start: idx,
                    end: candEnd,
                    prefixUnits: prefixUnits,
                    suffixUnits: suffixUnits
                )
                let dist = abs(idx - anchor.start)

                if isShortQuoteRejected(
                    quoteLength: exactUnits.count,
                    hasContext: !prefixUnits.isEmpty || !suffixUnits.isEmpty,
                    prefixScore: ctx.prefixScore,
                    suffixScore: ctx.suffixScore,
                    distance: dist,
                    maxProximityForShortQuote: maxProximityForShortQuote
                ) {
                    continue
                }

                let score = ctx.prefixScore + ctx.suffixScore
                if score > bestScore || (score == bestScore && dist < bestDist) {
                    bestScore = score
                    bestDist = dist
                    bestStart = idx
                }
            }

            if bestStart != -1 {
                return withAttachedBounds(anchor, start: bestStart, end: bestStart + exactUnits.count)
            }
        }

        // 3a. Whitespace-normalized quote search
        let normExactUnits = Array(normalizeQuoteWhitespace(anchor.quote.exact).utf16)
        if !normExactUnits.isEmpty {
            let normMap = buildWhitespaceNormalizedMap(docUnits: docUnits)
            let normCandidates = findAllOccurrences(in: normMap.normalizedUnits, needle: normExactUnits)
            if !normCandidates.isEmpty {
                var bestOrigStart = -1
                var bestOrigEnd = -1
                var bestScore = -1.0
                var bestDist = Int.max

                for normIdx in normCandidates {
                    let origStart = normMap.normToOrigStart[normIdx]
                    let origEnd = normMap.normToOrigEnd[normIdx + normExactUnits.count - 1]
                    let ctx = scoreContext(
                        docUnits: docUnits,
                        start: origStart,
                        end: origEnd,
                        prefixUnits: prefixUnits,
                        suffixUnits: suffixUnits
                    )
                    let dist = abs(origStart - anchor.start)

                    if isShortQuoteRejected(
                        quoteLength: exactUnits.count,
                        hasContext: !prefixUnits.isEmpty || !suffixUnits.isEmpty,
                        prefixScore: ctx.prefixScore,
                        suffixScore: ctx.suffixScore,
                        distance: dist,
                        maxProximityForShortQuote: maxProximityForShortQuote
                    ) {
                        continue
                    }

                    let score = ctx.prefixScore + ctx.suffixScore
                    if score > bestScore || (score == bestScore && dist < bestDist) {
                        bestScore = score
                        bestDist = dist
                        bestOrigStart = origStart
                        bestOrigEnd = origEnd
                    }
                }

                if bestOrigStart != -1 {
                    return withAttachedBounds(anchor, start: bestOrigStart, end: bestOrigEnd)
                }
            }
        }

        // 3b. Context-framed fuzzy match
        if prefixUnits.count >= 4, suffixUnits.count >= 4 {
            let prefixMatches = findAllOccurrences(in: docUnits, needle: prefixUnits)
            let suffixMatches = findAllOccurrences(in: docUnits, needle: suffixUnits)
            let maxSpanLength = max(exactUnits.count * 2, exactUnits.count + 32)

            var bestStart = -1
            var bestEnd = -1
            var bestSimilarity = -1.0
            var bestDist = Int.max

            for pIdx in prefixMatches {
                let spanStart = pIdx + prefixUnits.count
                for sIdx in suffixMatches {
                    if sIdx < spanStart { continue }
                    let spanLength = sIdx - spanStart
                    if spanLength == 0 || spanLength > maxSpanLength { continue }

                    let candidateSlice = Array(docUnits[spanStart..<sIdx])
                    let maxLen = max(candidateSlice.count, exactUnits.count)
                    let similarity = maxLen == 0
                        ? 1.0
                        : 1.0 - Double(levenshteinDistance(candidateSlice, exactUnits)) / Double(maxLen)
                    if similarity < fuzzyThreshold { continue }

                    let dist = abs(spanStart - anchor.start)
                    if similarity > bestSimilarity || (similarity == bestSimilarity && dist < bestDist) {
                        bestSimilarity = similarity
                        bestDist = dist
                        bestStart = spanStart
                        bestEnd = sIdx
                    }
                }
            }

            if bestStart != -1 {
                return withAttachedBounds(anchor, start: bestStart, end: bestEnd)
            }
        }

        // 4. Mark orphaned while preserving original offsets and quote
        return TextAnchor(
            start: anchor.start,
            end: anchor.end,
            quote: anchor.quote,
            state: .orphaned
        )
    }

    public static func reconcileConversations(
        _ conversations: [Conversation],
        in documentText: String,
        fuzzyThreshold: Double = defaultFuzzyThreshold,
        maxProximityForShortQuote: Int = defaultMaxProximityForShortQuote
    ) -> [Conversation] {
        conversations.map { convo in
            guard let anchor = convo.anchor else { return convo }
            var updated = convo
            updated.anchor = reconcile(
                anchor,
                in: documentText,
                fuzzyThreshold: fuzzyThreshold,
                maxProximityForShortQuote: maxProximityForShortQuote
            )
            return updated
        }
    }

    public static func filterByEntity(
        _ conversations: [Conversation],
        entityId: String,
        entityType: String? = nil
    ) -> [Conversation] {
        conversations.filter { convo in
            convo.entity.id == entityId && (entityType == nil || convo.entity.type == entityType)
        }
    }

    public static func sortByAnchor(
        _ conversations: [Conversation],
        orphanedLast: Bool = false
    ) -> [Conversation] {
        conversations.sorted { a, b in
            let aAnchored = a.anchor != nil
            let bAnchored = b.anchor != nil
            if aAnchored != bAnchored {
                return aAnchored
            }

            if let aAnchor = a.anchor, let bAnchor = b.anchor {
                if orphanedLast && aAnchor.state != bAnchor.state {
                    return aAnchor.state == .attached
                }
                if aAnchor.start != bAnchor.start {
                    return aAnchor.start < bAnchor.start
                }
                if aAnchor.end != bAnchor.end {
                    return aAnchor.end < bAnchor.end
                }
            }

            let timeA = parseISO8601Timestamp(a.createdAt)
            let timeB = parseISO8601Timestamp(b.createdAt)
            if timeA != timeB {
                return timeA < timeB
            }
            return a.id < b.id
        }
    }

    // MARK: - Private helpers

    private static func decodeUTF16(_ units: [UInt16], from start: Int, to end: Int) -> String {
        guard start < end, start >= 0, end <= units.count else { return "" }
        return String(decoding: units[start..<end], as: UTF16.self)
    }

    private static func withAttachedBounds(_ anchor: TextAnchor, start: Int, end: Int) -> TextAnchor {
        TextAnchor(start: start, end: end, quote: anchor.quote, state: .attached)
    }

    private static func reconcileEmptyQuote(
        anchor: TextAnchor,
        docUnits: [UInt16],
        prefixUnits: [UInt16],
        suffixUnits: [UInt16]
    ) -> TextAnchor {
        if prefixUnits.isEmpty && suffixUnits.isEmpty {
            if anchor.start <= docUnits.count {
                return withAttachedBounds(anchor, start: anchor.start, end: anchor.start)
            }
            return TextAnchor(start: anchor.start, end: anchor.end, quote: anchor.quote, state: .orphaned)
        }

        if anchor.start <= docUnits.count {
            let ctx = scoreContext(
                docUnits: docUnits,
                start: anchor.start,
                end: anchor.start,
                prefixUnits: prefixUnits,
                suffixUnits: suffixUnits
            )
            if (prefixUnits.isEmpty || ctx.prefixExact) && (suffixUnits.isEmpty || ctx.suffixExact) {
                return withAttachedBounds(anchor, start: anchor.start, end: anchor.start)
            }
        }

        let boundaryNeedle = prefixUnits + suffixUnits
        let candidates = findAllOccurrences(in: docUnits, needle: boundaryNeedle)
        if !candidates.isEmpty {
            var bestPos = candidates[0] + prefixUnits.count
            var bestDist = abs(bestPos - anchor.start)
            for idx in candidates.dropFirst() {
                let pos = idx + prefixUnits.count
                let dist = abs(pos - anchor.start)
                if dist < bestDist {
                    bestDist = dist
                    bestPos = pos
                }
            }
            return withAttachedBounds(anchor, start: bestPos, end: bestPos)
        }

        return TextAnchor(start: anchor.start, end: anchor.end, quote: anchor.quote, state: .orphaned)
    }

    private static func findAllOccurrences(in haystack: [UInt16], needle: [UInt16]) -> [Int] {
        guard !needle.isEmpty, haystack.count >= needle.count else { return [] }
        var indices: [Int] = []
        let limit = haystack.count - needle.count
        var i = 0
        while i <= limit {
            var matched = true
            for j in 0..<needle.count {
                if haystack[i + j] != needle[j] {
                    matched = false
                    break
                }
            }
            if matched {
                indices.append(i)
            }
            i += 1
        }
        return indices
    }

    private static func scoreContext(
        docUnits: [UInt16],
        start: Int,
        end: Int,
        prefixUnits: [UInt16],
        suffixUnits: [UInt16]
    ) -> (prefixScore: Double, suffixScore: Double, prefixExact: Bool, suffixExact: Bool) {
        var prefixScore = 0.0
        var prefixExact = false
        if !prefixUnits.isEmpty {
            let available = min(prefixUnits.count, start)
            var matched = 0
            while matched < available && docUnits[start - 1 - matched] == prefixUnits[prefixUnits.count - 1 - matched] {
                matched += 1
            }
            prefixScore = Double(matched) / Double(prefixUnits.count)
            prefixExact = matched == prefixUnits.count
        }

        var suffixScore = 0.0
        var suffixExact = false
        if !suffixUnits.isEmpty {
            let available = min(suffixUnits.count, docUnits.count - end)
            var matched = 0
            while matched < available && docUnits[end + matched] == suffixUnits[matched] {
                matched += 1
            }
            suffixScore = Double(matched) / Double(suffixUnits.count)
            suffixExact = matched == suffixUnits.count
        }

        return (prefixScore, suffixScore, prefixExact, suffixExact)
    }

    private static func isShortQuoteRejected(
        quoteLength: Int,
        hasContext: Bool,
        prefixScore: Double,
        suffixScore: Double,
        distance: Int,
        maxProximityForShortQuote: Int
    ) -> Bool {
        quoteLength < 4 &&
            hasContext &&
            (prefixScore + suffixScore) == 0.0 &&
            distance > maxProximityForShortQuote
    }

    private static func isASCIIOrUnicodeWhitespace(_ unit: UInt16) -> Bool {
        switch unit {
        case 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x00A0:
            return true
        default:
            if let scalar = UnicodeScalar(unit) {
                return CharacterSet.whitespacesAndNewlines.contains(scalar)
            }
            return false
        }
    }

    private static func buildWhitespaceNormalizedMap(docUnits: [UInt16]) -> (
        normalizedUnits: [UInt16],
        normToOrigStart: [Int],
        normToOrigEnd: [Int]
    ) {
        var normalizedUnits: [UInt16] = []
        var normToOrigStart: [Int] = []
        var normToOrigEnd: [Int] = []

        var i = 0
        while i < docUnits.count {
            if isASCIIOrUnicodeWhitespace(docUnits[i]) {
                let start = i
                while i < docUnits.count && isASCIIOrUnicodeWhitespace(docUnits[i]) {
                    i += 1
                }
                normalizedUnits.append(0x0020) // ' '
                normToOrigStart.append(start)
                normToOrigEnd.append(i)
            } else {
                normalizedUnits.append(docUnits[i])
                normToOrigStart.append(i)
                normToOrigEnd.append(i + 1)
                i += 1
            }
        }

        return (normalizedUnits, normToOrigStart, normToOrigEnd)
    }

    private static func normalizeQuoteWhitespace(_ exact: String) -> String {
        let components = exact.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
        if !components.isEmpty {
            return components.joined(separator: " ")
        }
        return exact.isEmpty ? "" : " "
    }

    private static func levenshteinDistance(_ a: [UInt16], _ b: [UInt16]) -> Int {
        let m = a.count
        let n = b.count
        if m == 0 { return n }
        if n == 0 { return m }

        var prev = Array(0...n)
        var curr = Array(repeating: 0, count: n + 1)

        for i in 1...m {
            curr[0] = i
            let ca = a[i - 1]
            for j in 1...n {
                let cost = ca == b[j - 1] ? 0 : 1
                curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
            }
            swap(&prev, &curr)
        }

        return prev[n]
    }
}

func parseISO8601Timestamp(_ value: String) -> TimeInterval {
    let withFractional = ISO8601DateFormatter()
    withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFractional.date(from: value) {
        return date.timeIntervalSince1970
    }
    let basic = ISO8601DateFormatter()
    basic.formatOptions = [.withInternetDateTime]
    if let date = basic.date(from: value) {
        return date.timeIntervalSince1970
    }
    return 0
}
