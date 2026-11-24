// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ConversationsKit",
    platforms: [
        .macOS(.v13),
        .iOS(.v16)
    ],
    products: [
        .library(
            name: "ConversationsKit",
            targets: ["ConversationsKit"]
        )
    ],
    targets: [
        .target(
            name: "ConversationsKit",
            path: "swift/Sources/ConversationsKit"
        ),
        .testTarget(
            name: "ConversationsKitTests",
            dependencies: ["ConversationsKit"],
            path: "swift/Tests/ConversationsKitTests"
        )
    ]
)
