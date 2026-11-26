import Foundation

public enum ThreadTree {
    /// Builds a hierarchical tree from a flat array of messages.
    /// Breaks cycles safely (promoting only nodes on the cycle to root) and handles missing parents.
    public static func buildTree(
        messages: [Message],
        orphanStrategy: OrphanStrategy = .placeholder
    ) -> [ThreadTreeNode] {
        guard !messages.isEmpty else { return [] }

        let sorted = messages.sorted { a, b in
            parseISO8601Timestamp(a.createdAt) < parseISO8601Timestamp(b.createdAt)
        }

        var messageMap: [String: Message] = [:]
        messageMap.reserveCapacity(sorted.count)
        for msg in sorted {
            messageMap[msg.id] = msg
        }

        var safeParentMap: [String: String?] = [:]
        safeParentMap.reserveCapacity(sorted.count)

        for msg in sorted {
            guard let parentId = msg.parentId, !parentId.isEmpty else {
                safeParentMap[msg.id] = .some(nil)
                continue
            }

            var currParent: String? = parentId
            var seen: Set<String> = [msg.id]
            var isCycle = false

            while let current = currParent, !current.isEmpty {
                if seen.contains(current) {
                    isCycle = (current == msg.id)
                    break
                }
                seen.insert(current)
                currParent = messageMap[current]?.parentId
            }

            safeParentMap[msg.id] = isCycle ? .some(nil) : .some(parentId)
        }

        var childrenMap: [String: [Message]] = [:]
        var rootMessages: [Message] = []
        var syntheticParents: [String: Message] = [:]

        for msg in sorted {
            let resolvedParent = safeParentMap[msg.id] ?? nil
            guard let parentId = resolvedParent, !parentId.isEmpty else {
                rootMessages.append(msg)
                continue
            }

            if messageMap[parentId] != nil {
                childrenMap[parentId, default: []].append(msg)
            } else if orphanStrategy == .root {
                rootMessages.append(msg)
            } else {
                if syntheticParents[parentId] == nil {
                    let placeholder = Message(
                        id: parentId,
                        conversationId: msg.conversationId,
                        author: NotificationActor(
                            id: "system",
                            name: "Deleted Comment",
                            type: .system
                        ),
                        content: "[This comment was deleted]",
                        status: .deleted,
                        mentions: [],
                        attachments: [],
                        reactions: [],
                        createdAt: msg.createdAt
                    )
                    syntheticParents[parentId] = placeholder
                    rootMessages.append(placeholder)
                }
                childrenMap[parentId, default: []].append(msg)
            }
        }

        func buildSubtree(_ msg: Message, depth: Int) -> ThreadTreeNode {
            let children = childrenMap[msg.id] ?? []
            return ThreadTreeNode(
                message: msg,
                depth: depth,
                children: children.map { buildSubtree($0, depth: depth + 1) },
                isSyntheticParent: syntheticParents[msg.id] != nil
            )
        }

        return rootMessages.map { buildSubtree($0, depth: 0) }
    }

    public static func flattenTree(_ nodes: [ThreadTreeNode]) -> [Message] {
        var result: [Message] = []

        func traverse(_ node: ThreadTreeNode) {
            result.append(node.message)
            for child in node.children {
                traverse(child)
            }
        }

        for node in nodes {
            traverse(node)
        }
        return result
    }

    public static func countDescendants(_ node: ThreadTreeNode) -> Int {
        var count = node.children.count
        for child in node.children {
            count += countDescendants(child)
        }
        return count
    }
}
