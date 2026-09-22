package com.computerk.betterdungeon

import org.json.JSONArray
import org.json.JSONObject

/** Native source of truth for behavior that differs inside Android WebView. */
object BetterDungeonPlatformConfig {
    private val capabilities = linkedMapOf(
        "nativeBridge" to true,
        "nativeAiTransport" to true,
        "nativeWebFetch" to true,
        "popupBridge" to true,
        "physicalBack" to true,
        "touchControls" to true,
        "imeViewportHandling" to true,
        "caretScrollFix" to true,
        "storageAreasAliased" to true,
        "embeddedLoginRestricted" to true,
        "nativeAssetDataUri" to true,
        "androidSettings" to true,
        "longWebViewTransitions" to true,
        "draggableWidgetControl" to true,
    )

    private val supportedFeatures = listOf(
        "ultrascripts",
        "command",
        "try",
        "triggerHighlight",
        "favoriteInstructions",
        "inputModeColor",
        "characterPreset",
        "autoSee",
        "storyCardAnalytics",
        "notes",
        "inputHistory",
        "customDynamic",
        "navigator",
    )

    fun toJson(): String = JSONObject()
        .put("kind", "android-webview")
        .put("formFactor", "mobile")
        .put("capabilities", JSONObject(capabilities as Map<*, *>))
        .put("supportedFeatures", JSONArray(supportedFeatures))
        .toString()
}
