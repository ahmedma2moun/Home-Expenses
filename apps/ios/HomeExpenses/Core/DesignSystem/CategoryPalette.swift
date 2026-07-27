import SwiftUI
import UIKit

/// A fixed-order 8-slot categorical palette, validated for CVD-safety and contrast on adjacent
/// marks (pie slices, lines) in both light and dark mode. Never cycled — a 9th+ category doesn't
/// get a generated hue, it folds into `other` (see `AnalyticsChartData.foldedCategoryId`).
enum CategoryPalette {
    static let maxSeries = 8

    static let other = dynamic(light: 0x89_87_81, dark: 0x89_87_81)

    private static let slots: [Color] = [
        dynamic(light: 0x2a_78_d6, dark: 0x39_87_e5), // blue
        dynamic(light: 0xeb_68_34, dark: 0xd9_59_26), // orange
        dynamic(light: 0x1b_af_7a, dark: 0x19_9e_70), // aqua
        dynamic(light: 0xed_a1_00, dark: 0xc9_85_00), // yellow
        dynamic(light: 0xe8_7b_a4, dark: 0xd5_51_81), // magenta
        dynamic(light: 0x00_83_00, dark: 0x00_83_00), // green
        dynamic(light: 0x4a_3a_a7, dark: 0x90_85_e9), // violet
        dynamic(light: 0xe3_49_48, dark: 0xe6_67_67), // red
    ]

    /// `rank` is 0-based, e.g. the category's index after sorting by spend descending.
    static func color(atRank rank: Int) -> Color {
        guard slots.indices.contains(rank) else { return other }
        return slots[rank]
    }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { trait in
            trait.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
