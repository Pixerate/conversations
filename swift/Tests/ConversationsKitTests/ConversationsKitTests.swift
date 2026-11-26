import XCTest
@testable import ConversationsKit

final class ConversationsKitTests: XCTestCase {
    func testDecodesMinimalWireJSONWithCanonicalDefaults() throws {
        let convoJSON = """
        {
          "id": "convo_1",
          "entity": { "id": "doc_1" },
          "createdAt": "2026-11-24T12:00:00.000Z",
          "updatedAt": "2026-11-24T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let convo = try JSONDecoder().decode(Conversation.self, from: convoJSON)
        XCTAssertEqual(convo.id, "convo_1")
        XCTAssertEqual(convo.entity.type, "task")
        XCTAssertEqual(convo.status, .open)
        XCTAssertEqual(convo.participantIds, [])
        XCTAssertEqual(convo.messageCount, 0)
        XCTAssertNil(convo.anchor)

        let msgJSON = """
        {
          "id": "msg_1",
          "conversationId": "convo_1",
          "author": { "id": "user_1" },
          "content": "Hello",
          "parentId": null,
          "createdAt": "2026-11-24T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let msg = try JSONDecoder().decode(Message.self, from: msgJSON)
        XCTAssertEqual(msg.author.type, .user)
        XCTAssertEqual(msg.status, .sent)
        XCTAssertEqual(msg.mentions, [])
        XCTAssertEqual(msg.attachments, [])
        XCTAssertEqual(msg.reactions, [])
        XCTAssertNil(msg.parentId)
    }

    func testRoundTripsFullAnchoredConversationAndMetadataJSON() throws {
        let original = Conversation(
            id: "convo_doc_1",
            entity: EntityRef(
                id: "doc_1",
                type: "document",
                title: "Architecture Spec",
                projectId: "proj_1",
                metadata: ["draft": .bool(true), "revision": .number(3)]
            ),
            anchor: TextAnchor(
                start: 10,
                end: 25,
                quote: TextQuoteSelector(exact: "inline comments", prefix: "support ", suffix: " in docs"),
                state: .attached
            ),
            status: .open,
            participantIds: ["u1"],
            messageCount: 1,
            lastMessageAt: "2026-11-24T12:05:00.000Z",
            metadata: ["tags": .array([.string("review"), .string("v1")])],
            createdAt: "2026-11-24T12:00:00.000Z",
            updatedAt: "2026-11-24T12:05:00.000Z"
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(Conversation.self, from: data)
        XCTAssertEqual(decoded, original)
        XCTAssertEqual(decoded.anchor?.nsRange, NSRange(location: 10, length: 15))
    }

    func testRejectsInvalidTextAnchorRangeDuringDecode() {
        let invalidJSON = """
        {
          "start": 12,
          "end": 5,
          "quote": { "exact": "broken" }
        }
        """.data(using: .utf8)!

        XCTAssertThrowsError(try JSONDecoder().decode(TextAnchor.self, from: invalidJSON))
    }

    func testUTF16OffsetsAndEmojiReanchoringMatchJS() throws {
        let text = "Hello 👋🏽 world 👨‍👩‍👧 anchor target end"
        let nsText = text as NSString
        let targetRange = nsText.range(of: "anchor target")
        XCTAssertNotEqual(targetRange.location, NSNotFound)

        let anchor = try TextAnchorReconciler.create(
            in: text,
            start: targetRange.location,
            end: NSMaxRange(targetRange)
        )
        XCTAssertEqual(anchor.quote.exact, "anchor target")
        XCTAssertEqual(anchor.nsRange, targetRange)

        // Insert prefix before the emoji & anchor
        let edited = "Intro! " + text + " trailing."
        let reconciled = TextAnchorReconciler.reconcile(anchor, in: edited)
        XCTAssertEqual(reconciled.state, .attached)
        XCTAssertEqual(reconciled.start, anchor.start + 7)
        XCTAssertEqual(reconciled.end, anchor.end + 7)
        XCTAssertEqual((edited as NSString).substring(with: reconciled.nsRange), "anchor target")
    }

    func testReconcilerDisambiguatesDuplicatesReflowFuzzyAndUndo() throws {
        let doc = "First section: note this carefully.\nSecond section: note this immediately."
        let secondIdx = (doc as NSString).range(of: "Second section: note this").location
        let noteOffset = secondIdx + "Second section: ".utf16.count
        let anchor = try TextAnchorReconciler.create(in: doc, start: noteOffset, end: noteOffset + 9)
        XCTAssertEqual(anchor.quote.exact, "note this")

        // Edit before first section + disambiguate second occurrence
        let shiftedDoc = "Header\n" + doc
        let shifted = TextAnchorReconciler.reconcile(anchor, in: shiftedDoc)
        XCTAssertEqual(shifted.state, .attached)
        XCTAssertEqual(shifted.start, noteOffset + 7)

        // Whitespace reflow across line break
        let reflowBase = "Intro paragraph.\nSecond section: note this immediately."
        let reflowIdx = (reflowBase as NSString).range(of: "note this").location
        let reflowAnchor = try TextAnchorReconciler.create(in: reflowBase, start: reflowIdx, end: reflowIdx + 9)
        let wrappedDoc = "Intro paragraph.\nSecond section: note\n  this immediately."
        let reflowed = TextAnchorReconciler.reconcile(reflowAnchor, in: wrappedDoc)
        XCTAssertEqual(reflowed.state, .attached)
        XCTAssertEqual((wrappedDoc as NSString).substring(with: reflowed.nsRange), "note\n  this")

        // Context-framed fuzzy match (long enough prefix + suffix, internal typo change)
        let framedDoc = "Alpha Beta Gamma Delta targetPhrase Epsilon Zeta Eta Theta"
        let tRange = (framedDoc as NSString).range(of: "targetPhrase")
        let framedAnchor = try TextAnchorReconciler.create(
            in: framedDoc,
            start: tRange.location,
            end: NSMaxRange(tRange),
            contextChars: 12
        )
        let typoDoc = "Alpha Beta Gamma Delta targetPhraze Epsilon Zeta Eta Theta"
        let fuzzy = TextAnchorReconciler.reconcile(framedAnchor, in: typoDoc)
        XCTAssertEqual(fuzzy.state, .attached)
        XCTAssertEqual((typoDoc as NSString).substring(with: fuzzy.nsRange), "targetPhraze")

        // Orphan when deleted, then re-attached on undo
        let deletedDoc = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta"
        let orphaned = TextAnchorReconciler.reconcile(framedAnchor, in: deletedDoc)
        XCTAssertEqual(orphaned.state, .orphaned)
        XCTAssertEqual(orphaned.quote.exact, "targetPhrase")

        let restored = TextAnchorReconciler.reconcile(orphaned, in: framedDoc)
        XCTAssertEqual(restored.state, .attached)
        XCTAssertEqual(restored.start, tRange.location)
    }

    func testShortQuoteDoesNotJumpFarAwayWithZeroContext() throws {
        let doc = "The word is ok here and nothing else."
        let okRange = (doc as NSString).range(of: "ok")
        let anchor = try TextAnchorReconciler.create(in: doc, start: okRange.location, end: NSMaxRange(okRange))
        let padding = String(repeating: "x", count: 100)
        let edited = "Completely rewritten paragraph \(padding)[ok]!"
        let reconciled = TextAnchorReconciler.reconcile(anchor, in: edited)
        XCTAssertEqual(reconciled.state, .orphaned)
    }

    func testThreadTreeHandlesDeepNestingCyclesAndOrphans() {
        let author = NotificationActor(id: "u1", name: "Alice", type: .user)
        var deepMessages: [Message] = []
        for i in 0..<12 {
            deepMessages.append(
                Message(
                    id: "m\(i)",
                    conversationId: "c1",
                    author: author,
                    content: "Level \(i)",
                    parentId: i == 0 ? nil : "m\(i - 1)",
                    createdAt: String(format: "2026-11-24T12:%02d:00.000Z", i)
                )
            )
        }
        let deepTree = ThreadTree.buildTree(messages: deepMessages)
        XCTAssertEqual(deepTree.count, 1)
        XCTAssertEqual(ThreadTree.countDescendants(deepTree[0]), 11)
        XCTAssertEqual(ThreadTree.flattenTree(deepTree).count, 12)

        // Cycle A <-> B with child C -> A kept under A
        let cycleMessages = [
            Message(id: "A", conversationId: "c1", author: author, content: "A", parentId: "B", createdAt: "2026-11-24T12:00:00.000Z"),
            Message(id: "B", conversationId: "c1", author: author, content: "B", parentId: "A", createdAt: "2026-11-24T12:01:00.000Z"),
            Message(id: "C", conversationId: "c1", author: author, content: "C", parentId: "A", createdAt: "2026-11-24T12:02:00.000Z")
        ]
        let cycleTree = ThreadTree.buildTree(messages: cycleMessages)
        XCTAssertEqual(cycleTree.map(\.message.id), ["A", "B"])
        XCTAssertEqual(cycleTree[0].children.map(\.message.id), ["C"])

        // Orphan strategy
        let orphanMsg = [
            Message(id: "orphan", conversationId: "c1", author: author, content: "Reply", parentId: "missing", createdAt: "2026-11-24T12:00:00.000Z")
        ]
        let placeholderTree = ThreadTree.buildTree(messages: orphanMsg, orphanStrategy: .placeholder)
        XCTAssertEqual(placeholderTree.count, 1)
        XCTAssertTrue(placeholderTree[0].isSyntheticParent)
        XCTAssertEqual(placeholderTree[0].children[0].message.id, "orphan")

        let rootTree = ThreadTree.buildTree(messages: orphanMsg, orphanStrategy: .root)
        XCTAssertEqual(rootTree.count, 1)
        XCTAssertFalse(rootTree[0].isSyntheticParent)
        XCTAssertEqual(rootTree[0].message.id, "orphan")
    }

    func testTranscriptIncludesAnchorContextAndFiltersOpenDocumentThreads() {
        let author = NotificationActor(id: "u1", name: "Alice", type: .user)
        let openConvo = Conversation(
            id: "c_open",
            entity: EntityRef(id: "doc_1", type: "document", title: "Spec"),
            anchor: TextAnchor(
                start: 10,
                end: 20,
                quote: TextQuoteSelector(exact: "rate limit", prefix: "enforce ", suffix: " per user"),
                state: .attached
            ),
            status: .open,
            createdAt: "2026-11-24T12:00:00.000Z",
            updatedAt: "2026-11-24T12:00:00.000Z"
        )
        let resolvedConvo = Conversation(
            id: "c_resolved",
            entity: EntityRef(id: "doc_1", type: "document", title: "Spec"),
            anchor: TextAnchor(
                start: 2,
                end: 7,
                quote: TextQuoteSelector(exact: "intro"),
                state: .attached
            ),
            status: .resolved,
            createdAt: "2026-11-24T11:00:00.000Z",
            updatedAt: "2026-11-24T11:30:00.000Z"
        )

        let single = ConversationTranscript.formatAsMarkdown(
            conversation: openConvo,
            messages: [
                Message(id: "m1", conversationId: "c_open", author: author, content: "Clarify limit", createdAt: "2026-11-24T12:00:00.000Z")
            ]
        )
        XCTAssertTrue(single.contains("**Anchor**: 10..20 (attached)"))
        XCTAssertTrue(single.contains("**Quoted Text**: \"rate limit\""))
        XCTAssertTrue(single.contains("**Anchor Context**: \"enforce [rate limit] per user\""))

        let docMarkdown = ConversationTranscript.formatDocumentCommentsAsMarkdown(
            threads: [
                DocumentTranscriptThread(conversation: openConvo, messages: [
                    Message(id: "m1", conversationId: "c_open", author: author, content: "Clarify limit", createdAt: "2026-11-24T12:00:00.000Z")
                ]),
                DocumentTranscriptThread(conversation: resolvedConvo, messages: [
                    Message(id: "m2", conversationId: "c_resolved", author: author, content: "Done", createdAt: "2026-11-24T11:00:00.000Z")
                ])
            ],
            options: DocumentTranscriptOptions(statusFilter: [.open])
        )
        XCTAssertTrue(docMarkdown.contains("# Document Comments: Spec"))
        XCTAssertTrue(docMarkdown.contains("**Threads**: 1"))
        XCTAssertTrue(docMarkdown.contains("c_open"))
        XCTAssertFalse(docMarkdown.contains("c_resolved"))
    }
}
