package com.computerk.betterdungeon

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.view.ViewGroup.MarginLayoutParams
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Main activity that hosts the AI Dungeon WebView and injects BetterDungeon.
 *
 * Architecture:
 * - Primary WebView loads play.aidungeon.com
 * - InjectionEngine injects all extension CSS/JS on page load
 * - BetterDungeonBridge provides @JavascriptInterface for storage + utilities
 * - Bottom sheet with secondary WebView hosts the popup UI
 * - FAB toggles the popup panel
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "BetterDungeon"
        private const val DEFAULT_AI_DUNGEON_URL = "https://play.aidungeon.com"
        private const val APP_PREFERENCES = "betterdungeon_app_preferences"
        private const val AI_DUNGEON_BRANCH_PREFERENCE = "ai_dungeon_branch"
        private val AI_DUNGEON_HOSTS = setOf(
            "play.aidungeon.com",
            "beta.aidungeon.com",
            "alpha.aidungeon.com"
        )
    }

    private lateinit var mainWebView: BetterDungeonWebView
    private lateinit var popupWebView: BetterDungeonWebView
    private lateinit var popupContainer: FrameLayout

    private lateinit var bridge: BetterDungeonBridge
    private lateinit var injectionEngine: InjectionEngine
    private lateinit var ttsManager: TextToSpeechManager

    private var popupLoaded = false
    private var backNavigationPending = false

    // ── Lifecycle ─────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Edge-to-edge rendering
        WindowCompat.setDecorFitsSystemWindows(window, false)

        setContentView(R.layout.activity_main)

        // Apply window insets to popup so it isn't hidden by system bars
        mainWebView = findViewById(R.id.webview_main)
        popupWebView = findViewById(R.id.webview_popup)
        popupContainer = findViewById(R.id.popup_container)

        ViewCompat.setOnApplyWindowInsetsListener(popupContainer) { view, insets ->
            val handledTypes =
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout()
            val systemInsets = insets.getInsets(handledTypes)

            // The popup handles these insets natively. Zero only those values
            // before they reach its WebView to avoid applying them twice.
            view.setPadding(
                systemInsets.left,
                systemInsets.top,
                systemInsets.right,
                systemInsets.bottom
            )
            WindowInsetsCompat.Builder(insets)
                .setInsets(handledTypes, Insets.NONE)
                .build()
        }

        // Initialize components
        bridge = BetterDungeonBridge(this)
        injectionEngine = InjectionEngine(this)
        ttsManager = TextToSpeechManager(this)
        val caretScrollFixEnabled = bridge.isCaretScrollFixEnabled()
        mainWebView.caretScrollFixEnabled = caretScrollFixEnabled
        popupWebView.caretScrollFixEnabled = caretScrollFixEnabled

        setupMainWebView()
        setupPopupWebView()
        setupBackNavigation()

        // Wire up bridge references for cross-WebView communication
        bridge.mainWebView = mainWebView
        bridge.popupWebView = popupWebView
        bridge.ttsManager = ttsManager
        bridge.onClosePopup = {
            hidePopup()
        }
        bridge.onShowPopup = {
            togglePopup()
        }

        // Preserve the full path, query, and fragment when launched from an
        // AI Dungeon link. Normal launcher starts reopen the remembered branch.
        loadAiDungeonUrl(intent.data)
    }

    override fun onDestroy() {
        bridge.shutdown()
        ttsManager.shutdown()
        mainWebView.destroy()
        popupWebView.destroy()
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.let(::loadAiDungeonUrl)
    }

    private fun loadAiDungeonUrl(uri: Uri?) {
        val requestedUri = uri?.takeIf(::isAiDungeonUri)
        if (requestedUri != null) {
            rememberAiDungeonBranch(requestedUri)
        }

        val url = requestedUri?.toString() ?: rememberedAiDungeonBranchUrl()
        mainWebView.loadUrl(url)
        Log.i(TAG, "Loading AI Dungeon: $url")
    }

    private fun isAiDungeonUri(uri: Uri): Boolean {
        if (uri.scheme?.lowercase() !in setOf("http", "https")) return false

        val host = uri.host?.lowercase() ?: return false
        return host in AI_DUNGEON_HOSTS
    }

    private fun rememberAiDungeonBranch(uri: Uri) {
        if (!isAiDungeonUri(uri)) return
        val host = uri.host?.lowercase() ?: return
        val preferences = getSharedPreferences(APP_PREFERENCES, MODE_PRIVATE)
        if (preferences.getString(AI_DUNGEON_BRANCH_PREFERENCE, null) == host) return

        preferences.edit()
            .putString(AI_DUNGEON_BRANCH_PREFERENCE, host)
            .apply()
        Log.i(TAG, "Remembered AI Dungeon branch: $host")
    }

    private fun rememberedAiDungeonBranchUrl(): String {
        val rememberedHost = getSharedPreferences(APP_PREFERENCES, MODE_PRIVATE)
            .getString(AI_DUNGEON_BRANCH_PREFERENCE, null)
            ?.lowercase()
            ?.takeIf { it in AI_DUNGEON_HOSTS }

        return rememberedHost?.let { "https://$it" } ?: DEFAULT_AI_DUNGEON_URL
    }

    // ── Main WebView ──────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupMainWebView() {
        mainWebView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            // AI Dungeon declares a device-width, fixed-scale viewport. An
            // overview scale gives Blink another reason to rerun its focused
            // editable zoom/scroll animation when the IME reports the caret.
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false

            // Enable modern web features
            mediaPlaybackRequiresUserGesture = false

            // User agent: append BetterDungeon identifier
            userAgentString = "$userAgentString BetterDungeon/1.0"
        }

        // Allow file access from file URLs (needed for asset loading)
        @Suppress("DEPRECATION")
        mainWebView.settings.allowFileAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        mainWebView.settings.allowUniversalAccessFromFileURLs = true

        // Add the JavaScript interface bridge
        mainWebView.addJavascriptInterface(bridge, BetterDungeonBridge.JS_INTERFACE_NAME)
        injectionEngine.installDocumentStartFix(mainWebView)

        mainWebView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                Log.d(TAG, "Page started loading: $url")
                val uri = Uri.parse(url)
                if (isAiDungeonUri(uri)) {
                    rememberAiDungeonBranch(uri)
                    injectionEngine.injectEarly(view)
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                Log.d(TAG, "Page loaded: $url")

                // Only inject on AI Dungeon pages
                if (isAiDungeonUri(Uri.parse(url))) {
                    injectionEngine.inject(view)
                }
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url.toString()

                // Keep AI Dungeon navigation inside the WebView
                if (isAiDungeonUri(request.url)) {
                    return false
                }

                // Open external links in system browser
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to open external URL: $url", e)
                }
                return true
            }
        }

        mainWebView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                val level = when (consoleMessage.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> "E"
                    ConsoleMessage.MessageLevel.WARNING -> "W"
                    else -> "D"
                }
                Log.println(
                    when (level) {
                        "E" -> Log.ERROR
                        "W" -> Log.WARN
                        else -> Log.DEBUG
                    },
                    "BDWebView",
                    "${consoleMessage.message()} (${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})"
                )
                return true
            }

        }
    }

    // ── Popup WebView ─────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupPopupWebView() {
        popupWebView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
        }

        @Suppress("DEPRECATION")
        popupWebView.settings.allowFileAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        popupWebView.settings.allowUniversalAccessFromFileURLs = true

        // Share the same bridge instance
        popupWebView.addJavascriptInterface(bridge, BetterDungeonBridge.JS_INTERFACE_NAME)
        injectionEngine.installDocumentStartFix(popupWebView)

        popupWebView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                Log.d(TAG, "Popup loaded: $url")

                // Inject the popup-to-content-script bridge
                injectPopupBridge(view)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url.toString()
                // Open any links from popup in system browser
                if (!url.startsWith("file:")) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to open URL from popup: $url", e)
                    }
                    return true
                }
                return false
            }
        }

        popupWebView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                Log.d(
                    "BDPopup",
                    "${consoleMessage.message()} (${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})"
                )
                return true
            }
        }
    }

    /**
     * Load the popup HTML from assets.
     */
    private fun loadPopup() {
        if (!popupLoaded) {
            popupWebView.loadUrl("file:///android_asset/betterdungeon/popup.html")
            popupLoaded = true
        }
    }

    /**
     * Inject a bridge script into the popup WebView that routes
     * chrome.tabs.sendMessage calls to the main WebView.
     *
     * The popup uses chrome.tabs.query + chrome.tabs.sendMessage to
     * communicate with content scripts. We intercept these in the popup
     * and forward them to the main WebView via evaluateJavascript.
     */
    private fun injectPopupBridge(popupView: WebView) {
        // The popup HTML already loads webview-polyfill.js via <script> tag,
        // giving it a working chrome.* API. Here we override the tabs methods
        // to route messages across the native bridge to the main WebView.
        val bridgeScript = """
            (function() {
                // Override tabs.query to return a tab referencing the main WebView
                chrome.tabs.query = function(queryInfo, callback) {
                    var fakeTabs = [{
                        id: 1,
                        url: '$DEFAULT_AI_DUNGEON_URL',
                        active: true,
                        currentWindow: true
                    }];
                    if (typeof callback === 'function') {
                        callback(fakeTabs);
                    }
                    return Promise.resolve(fakeTabs);
                };

                // Override tabs.sendMessage to forward to main WebView via native bridge
                window.__bdPopupCallbacks = window.__bdPopupCallbacks || Object.create(null);
                window.__bdPopupRequestCounter = window.__bdPopupRequestCounter || 0;
                window.__bdResolvePopupMessage = function(requestId, response) {
                    var pending = window.__bdPopupCallbacks[requestId];
                    if (!pending) return;
                    delete window.__bdPopupCallbacks[requestId];
                    clearTimeout(pending.timeoutId);
                    if (typeof pending.callback === 'function') {
                        pending.callback(response);
                    }
                    pending.resolve(response);
                };

                // Runtime messages (AI provider status/settings/tests) belong
                // to the main WebView runtime, where native stream callbacks
                // are delivered. Forward them through the same request map.
                chrome.runtime.sendMessage = function(messageOrExtensionId, messageOrCallback, optionsOrCallback, maybeCallback) {
                    var message = typeof messageOrExtensionId === 'string' ? messageOrCallback : messageOrExtensionId;
                    var callback = typeof messageOrCallback === 'function'
                        ? messageOrCallback
                        : (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback);
                    var requestId = 'popup-runtime-' + Date.now() + '-' + (++window.__bdPopupRequestCounter);
                    var messageJson = JSON.stringify(message);

                    return new Promise(function(resolve) {
                        var timeoutId = setTimeout(function() {
                            var pending = window.__bdPopupCallbacks[requestId];
                            if (pending) {
                                delete window.__bdPopupCallbacks[requestId];
                                if (typeof callback === 'function') callback(undefined);
                                resolve(undefined);
                            }
                        }, 120000);
                        window.__bdPopupCallbacks[requestId] = {
                            callback: callback,
                            resolve: resolve,
                            timeoutId: timeoutId
                        };
                        BetterDungeonBridge.forwardToMainWebView(messageJson, requestId);
                    });
                };

                chrome.tabs.sendMessage = function(tabId, message, optionsOrCallback, maybeCallback) {
                    var callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
                    var requestId = 'popup-' + Date.now() + '-' + (++window.__bdPopupRequestCounter);
                    var messageJson = JSON.stringify(message);
                    BetterDungeonBridge.log('Popup sending message: ' + message.type);

                    // Return a Promise that resolves when the native bridge
                    // sends the response back from the main WebView.
                    return new Promise(function(resolve) {
                        // Timeout fallback: resolve with undefined after 120s
                        // so the popup never hangs indefinitely.
                        var timeoutId = setTimeout(function() {
                            var pending = window.__bdPopupCallbacks[requestId];
                            if (pending) {
                                delete window.__bdPopupCallbacks[requestId];
                                if (typeof callback === 'function') {
                                    callback(undefined);
                                }
                                resolve(undefined);
                            }
                        }, 120000);
                        window.__bdPopupCallbacks[requestId] = {
                            callback: callback,
                            resolve: resolve,
                            timeoutId: timeoutId
                        };
                        BetterDungeonBridge.forwardToMainWebView(messageJson, requestId);
                    });
                };
                
                // Override window.close() to collapse the popup panel
                window.close = function() {
                    BetterDungeonBridge.closePopup();
                };

                // Let popup controllers distinguish the temporary WebView
                // polyfill from the native cross-WebView message route. The
                // flag also covers the unlikely case where a controller is
                // initialized after this event has already fired.
                window.__bdPopupBridgeReady = true;
                window.dispatchEvent(new CustomEvent('betterdungeon:popup-bridge-ready'));
                console.log('[BetterDungeon] Popup bridge injected');
            })();
        """.trimIndent()

        popupView.evaluateJavascript(bridgeScript, null)
    }

    // ── Full Screen Popup ─────────────────────────────────────────────

    private fun togglePopup() {
        if (popupContainer.visibility == View.GONE) {
            loadPopup()
            showPopup()
        } else {
            hidePopup()
        }
    }
    
    private fun showPopup() {
        popupContainer.visibility = View.VISIBLE
        ViewCompat.requestApplyInsets(popupContainer)
    }
    
    private fun hidePopup() {
        popupContainer.visibility = View.GONE
    }

    // ── Back Navigation ───────────────────────────────────────────────

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // The native settings popup always has first priority.
                if (popupContainer.visibility == View.VISIBLE) {
                    hidePopup()
                    return
                }

                // evaluateJavascript is asynchronous. Ignore repeat presses until
                // Navigator has either consumed Back or yielded to WebView history.
                if (backNavigationPending) return
                backNavigationPending = true

                mainWebView.evaluateJavascript(
                    """
                    (function() {
                        try {
                            return typeof window.__bdNavigatorHandleBack === 'function' &&
                                window.__bdNavigatorHandleBack() === true;
                        } catch (error) {
                            console.warn('[BetterDungeon] Navigator Back handler failed:', error);
                            return false;
                        }
                    })();
                    """.trimIndent()
                ) { result ->
                    backNavigationPending = false
                    if (result.trim().equals("true", ignoreCase = true)) return@evaluateJavascript

                    if (mainWebView.canGoBack()) {
                        mainWebView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })
    }
}
