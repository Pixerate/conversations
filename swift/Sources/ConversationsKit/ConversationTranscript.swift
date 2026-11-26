import Foundation

public struct TranscriptOptions: Sendable, Equatable {
    public var includeMetadata: Bool
    public var includeAnchorContext: Bool
    public var indentString: String
    public var maxDepth: Int?

    public init(
        includeMetadata: Bool = false,
        includeAnchorContext: Bool = true,
        indentString: String = "  ",
        maxDepth: Int? = nil
    ) {
        self.includeMetadata = includeMetadata
        self.includeAnchorContext = includeAnchorContext
        self.indentString = indentString
        self.maxDepth = maxDepth
    }
}

public struct DocumentTranscriptThread: Sendable, Equatable {
    public var conversation: Conversation
    public var messages: [Message]

    public init(conversation: Conversation, messages: [Message]) {
        self.conversation = conversation
        self.messages = messages
    }
}

public struct DocumentTranscriptOptions: Sendable, Equatable {
    public var title: String?
    public var statusFilter: Set<ConversationStatus>?
    public var orphanedLast: Bool
    public var includeMetadata: Bool
    public var includeAnchorContext: Bool
    public var indentString: String
    public var maxDepth: Int?

    public init(
        title: String? = nil,
        statusFilter: Set<ConversationStatus>? = nil,
        orphanedLast: Bool = false,
        includeMetadata: Bool = false,
        includeAnchorContext: Bool = true,
        indentString: String = "  ",
        maxDepth: Int? = nil
    ) {
        self.title = title
        self.statusFilter = statusFilter
        self.orphanedLast = orphanedLast
        self.includeMetadata = includeMetadata
        self.includeAnchorContext = includeAnchorContext
        self.indentString = indentString
        self.maxDepth = maxDepth
    }
}

public enum ConversationTranscript {
    public static func formatAsMarkdown(
        conversation: Conversation,
        messages: [Message],
        options: TranscriptOptions = TranscriptOptions()
    ) -> String {
        var lines: [String] = []
        lines.append("# Conversation: \(conversation.entity.title ?? conversation.entity.id)")
        lines.append("**Target**: \(conversation.entity.type) (\(conversation.entity.id))")
        lines.append("**Status**: \(conversation.status.rawValue)")
        lines.append("**Total Messages**: \(messages.count)")
        lines.append(contentsOf: renderAnchorLines(
            conversation: conversation,
            includeAnchorContext: options.includeAnchorContext
        ))
        lines.append("")
        lines.append("---")
        lines.append("")
        lines.append(contentsOf: renderMessageNodes(
            messages: messages,
            indentString: options.indentString,
            maxDepth: options.maxDepth
        ))

        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func formatDocumentCommentsAsMarkdown(
        threads: [DocumentTranscriptThread],
        options: DocumentTranscriptOptions = DocumentTranscriptOptions()
    ) -> String {
        let filtered: [DocumentTranscriptThread]
        if let statusFilter = options.statusFilter {
            filtered = threads.filter { statusFilter.contains($0.conversation.status) }
        } else {
            filtered = threads
        }

        let sortedConversations = TextAnchorReconciler.sortByAnchor(
            filtered.map { $0.conversation },
            orphanedLast: options.orphanedLast
        )
        let threadById = Dictionary(uniqueKeysWithValues: filtered.map { ($0.conversation.id, $0) })
        let firstEntity = sortedConversations.first?.entity ?? threads.first?.conversation.entity
        let title = options.title ?? firstEntity?.title ?? firstEntity?.id ?? "Document"

        var lines: [String] = []
        lines.append("# Document Comments: \(title)")
        if let entity = firstEntity {
            lines.append("**Target**: \(entity.type) (\(entity.id))")
        }
        lines.append("**Threads**: \(sortedConversations.count)")
        lines.append("")
        lines.append("---")
        lines.append("")

        for convo in sortedConversations {
            guard let entry = threadById[convo.id] else { continue }
            let anchorSummary = convo.anchor.map {
                " — \($0.start)..\($0.end) (\($0.state.rawValue))"
            } ?? ""
            lines.append("## [\(convo.status.rawValue)] Thread \(convo.id)\(anchorSummary)")
            lines.append(contentsOf: renderAnchorLines(
                conversation: convo,
                includeAnchorContext: options.includeAnchorContext
            ))
            lines.append("")
            lines.append(contentsOf: renderMessageNodes(
                messages: entry.messages,
                indentString: options.indentString,
                maxDepth: options.maxDepth
            ))
        }

        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Private helpers

    private static func escapeSingleLine(_ text: String) -> String {
        text.replacingOccurrences(of: "\n", with: "\\n")
    }

    private static func renderAnchorLines(
        conversation: Conversation,
        includeAnchorContext: Bool
    ) -> [String] {
        guard let anchor = conversation.anchor else { return [] }
        var lines: [String] = []
        lines.append("**Anchor**: \(anchor.start)..\(anchor.end) (\(anchor.state.rawValue))")
        lines.append("**Quoted Text**: \"\(escapeSingleLine(anchor.quote.exact))\"")
        if includeAnchorContext, (anchor.quote.prefix != nil || anchor.quote.suffix != nil) {
            let prefix = escapeSingleLine(anchor.quote.prefix ?? "")
            let exact = escapeSingleLine(anchor.quote.exact)
            let suffix = escapeSingleLine(anchor.quote.suffix ?? "")
            lines.append("**Anchor Context**: \"\(prefix)[\(exact)]\(suffix)\"")
        }
        return lines
    }

    private static func renderMessageNodes(
        messages: [Message],
        indentString: String,
        maxDepth: Int?
    ) -> [String] {
        var lines: [String] = []
        let tree = ThreadTree.buildTree(messages: messages)

        func renderNode(_ node: ThreadTreeNode) {
            if let maxDepth, node.depth > maxDepth {
                return
            }

            let prefix = String(repeating: indentString, count: node.depth)
            let authorName = node.message.author.name ?? node.message.author.id
            let authorRole = " (\(node.message.author.type.rawValue))"
            lines.append("\(prefix)### \(authorName)\(authorRole) - \(node.message.createdAt)")

            for line in node.message.content.components(separatedBy: "\n") {
                lines.append("\(prefix)> \(line)")
            }
            lines.append("")

            for child in node.children {
                renderNode(child)
            }
        }

        for root in tree {
            renderNode(root)
        }

        return lines
    }
}
