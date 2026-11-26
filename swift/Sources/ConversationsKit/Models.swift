import Foundation

/// A type-safe JSON value matching arbitrary `Record<string, unknown>` payloads on the wire.
public enum JSONValue: Codable, Sendable, Equatable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

public enum ActorType: String, Codable, Sendable, Equatable, Hashable {
    case user
    case agent
    case system
}

public struct NotificationActor: Codable, Sendable, Equatable, Hashable {
    public var id: String
    public var name: String?
    public var email: String?
    public var avatarUrl: String?
    public var type: ActorType

    public init(
        id: String,
        name: String? = nil,
        email: String? = nil,
        avatarUrl: String? = nil,
        type: ActorType = .user
    ) {
        self.id = id
        self.name = name
        self.email = email
        self.avatarUrl = avatarUrl
        self.type = type
    }

    enum CodingKeys: String, CodingKey {
        case id, name, email, avatarUrl, type
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        email = try container.decodeIfPresent(String.self, forKey: .email)
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        type = try container.decodeIfPresent(ActorType.self, forKey: .type) ?? .user
    }
}

public struct EntityRef: Codable, Sendable, Equatable, Hashable {
    public var id: String
    public var type: String
    public var title: String?
    public var projectId: String?
    public var metadata: [String: JSONValue]?

    public init(
        id: String,
        type: String = "task",
        title: String? = nil,
        projectId: String? = nil,
        metadata: [String: JSONValue]? = nil
    ) {
        self.id = id
        self.type = type
        self.title = title
        self.projectId = projectId
        self.metadata = metadata
    }

    enum CodingKeys: String, CodingKey {
        case id, type, title, projectId, metadata
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        type = try container.decodeIfPresent(String.self, forKey: .type) ?? "task"
        title = try container.decodeIfPresent(String.self, forKey: .title)
        projectId = try container.decodeIfPresent(String.self, forKey: .projectId)
        metadata = try container.decodeIfPresent([String: JSONValue].self, forKey: .metadata)
    }
}

public struct TextQuoteSelector: Codable, Sendable, Equatable, Hashable {
    public var exact: String
    public var prefix: String?
    public var suffix: String?

    public init(exact: String, prefix: String? = nil, suffix: String? = nil) {
        self.exact = exact
        self.prefix = prefix
        self.suffix = suffix
    }
}

public enum TextAnchorState: String, Codable, Sendable, Equatable, Hashable {
    case attached
    case orphaned
}

public struct TextAnchor: Codable, Sendable, Equatable, Hashable {
    /// Inclusive start offset in UTF-16 code units.
    public var start: Int
    /// Exclusive end offset in UTF-16 code units.
    public var end: Int
    public var quote: TextQuoteSelector
    public var state: TextAnchorState

    public init(
        start: Int,
        end: Int,
        quote: TextQuoteSelector,
        state: TextAnchorState = .attached
    ) {
        self.start = start
        self.end = end
        self.quote = quote
        self.state = state
    }

    public var isValidRange: Bool {
        start >= 0 && end >= start
    }

    /// UTF-16 `NSRange` representation compatible with `NSString`, `NSTextView`, and `UITextView`.
    public var nsRange: NSRange {
        NSRange(location: max(0, start), length: max(0, end - max(0, start)))
    }

    enum CodingKeys: String, CodingKey {
        case start, end, quote, state
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedStart = try container.decode(Int.self, forKey: .start)
        let decodedEnd = try container.decode(Int.self, forKey: .end)
        guard decodedStart >= 0, decodedEnd >= decodedStart else {
            throw DecodingError.dataCorruptedError(
                forKey: .end,
                in: container,
                debugDescription: "TextAnchor end offset (\(decodedEnd)) must be >= start offset (\(decodedStart)) and non-negative"
            )
        }
        start = decodedStart
        end = decodedEnd
        quote = try container.decode(TextQuoteSelector.self, forKey: .quote)
        state = try container.decodeIfPresent(TextAnchorState.self, forKey: .state) ?? .attached
    }
}

public typealias DocumentAnchor = TextAnchor

public enum MessageStatus: String, Codable, Sendable, Equatable, Hashable {
    case sent
    case pending
    case failed
    case deleted
}

public struct MessageReaction: Codable, Sendable, Equatable, Hashable {
    public var emoji: String
    public var sticker: String?
    public var userId: String
    public var createdAt: String?

    public init(
        emoji: String,
        sticker: String? = nil,
        userId: String,
        createdAt: String? = nil
    ) {
        self.emoji = emoji
        self.sticker = sticker
        self.userId = userId
        self.createdAt = createdAt
    }
}

public struct Message: Codable, Sendable, Equatable, Hashable {
    public var id: String
    public var conversationId: String
    public var author: NotificationActor
    public var content: String
    public var richContent: String?
    public var parentId: String?
    public var status: MessageStatus
    public var mentions: [String]
    public var stickers: [String]?
    public var attachments: [[String: JSONValue]]
    public var reactions: [MessageReaction]
    public var metadata: [String: JSONValue]?
    public var createdAt: String
    public var updatedAt: String?

    public init(
        id: String,
        conversationId: String,
        author: NotificationActor,
        content: String,
        richContent: String? = nil,
        parentId: String? = nil,
        status: MessageStatus = .sent,
        mentions: [String] = [],
        stickers: [String]? = nil,
        attachments: [[String: JSONValue]] = [],
        reactions: [MessageReaction] = [],
        metadata: [String: JSONValue]? = nil,
        createdAt: String,
        updatedAt: String? = nil
    ) {
        self.id = id
        self.conversationId = conversationId
        self.author = author
        self.content = content
        self.richContent = richContent
        self.parentId = parentId
        self.status = status
        self.mentions = mentions
        self.stickers = stickers
        self.attachments = attachments
        self.reactions = reactions
        self.metadata = metadata
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, conversationId, author, content, richContent, parentId, status
        case mentions, stickers, attachments, reactions, metadata, createdAt, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        conversationId = try container.decode(String.self, forKey: .conversationId)
        author = try container.decode(NotificationActor.self, forKey: .author)
        content = try container.decode(String.self, forKey: .content)
        richContent = try container.decodeIfPresent(String.self, forKey: .richContent)
        parentId = try container.decodeIfPresent(String.self, forKey: .parentId)
        status = try container.decodeIfPresent(MessageStatus.self, forKey: .status) ?? .sent
        mentions = try container.decodeIfPresent([String].self, forKey: .mentions) ?? []
        stickers = try container.decodeIfPresent([String].self, forKey: .stickers)
        attachments = try container.decodeIfPresent([[String: JSONValue]].self, forKey: .attachments) ?? []
        reactions = try container.decodeIfPresent([MessageReaction].self, forKey: .reactions) ?? []
        metadata = try container.decodeIfPresent([String: JSONValue].self, forKey: .metadata)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

public enum ConversationStatus: String, Codable, Sendable, Equatable, Hashable {
    case open
    case resolved
    case archived
}

public struct Conversation: Codable, Sendable, Equatable, Hashable {
    public var id: String
    public var entity: EntityRef
    public var anchor: TextAnchor?
    public var status: ConversationStatus
    public var participantIds: [String]
    public var messageCount: Int
    public var lastMessageAt: String?
    public var resolvedAt: String?
    public var resolvedBy: String?
    public var metadata: [String: JSONValue]?
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        entity: EntityRef,
        anchor: TextAnchor? = nil,
        status: ConversationStatus = .open,
        participantIds: [String] = [],
        messageCount: Int = 0,
        lastMessageAt: String? = nil,
        resolvedAt: String? = nil,
        resolvedBy: String? = nil,
        metadata: [String: JSONValue]? = nil,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.entity = entity
        self.anchor = anchor
        self.status = status
        self.participantIds = participantIds
        self.messageCount = messageCount
        self.lastMessageAt = lastMessageAt
        self.resolvedAt = resolvedAt
        self.resolvedBy = resolvedBy
        self.metadata = metadata
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, entity, anchor, status, participantIds, messageCount
        case lastMessageAt, resolvedAt, resolvedBy, metadata, createdAt, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        entity = try container.decode(EntityRef.self, forKey: .entity)
        anchor = try container.decodeIfPresent(TextAnchor.self, forKey: .anchor)
        status = try container.decodeIfPresent(ConversationStatus.self, forKey: .status) ?? .open
        participantIds = try container.decodeIfPresent([String].self, forKey: .participantIds) ?? []
        messageCount = try container.decodeIfPresent(Int.self, forKey: .messageCount) ?? 0
        lastMessageAt = try container.decodeIfPresent(String.self, forKey: .lastMessageAt)
        resolvedAt = try container.decodeIfPresent(String.self, forKey: .resolvedAt)
        resolvedBy = try container.decodeIfPresent(String.self, forKey: .resolvedBy)
        metadata = try container.decodeIfPresent([String: JSONValue].self, forKey: .metadata)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decode(String.self, forKey: .updatedAt)
    }
}

public enum OrphanStrategy: String, Sendable, Equatable, Hashable {
    case placeholder
    case root
}

public struct ThreadTreeNode: Sendable, Equatable {
    public var message: Message
    public var depth: Int
    public var children: [ThreadTreeNode]
    public var isSyntheticParent: Bool

    public init(
        message: Message,
        depth: Int,
        children: [ThreadTreeNode] = [],
        isSyntheticParent: Bool = false
    ) {
        self.message = message
        self.depth = depth
        self.children = children
        self.isSyntheticParent = isSyntheticParent
    }
}
