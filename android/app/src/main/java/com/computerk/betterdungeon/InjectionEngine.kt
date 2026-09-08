package com.computerk.betterdungeon

import android.content.Context
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * Handles injecting BetterDungeon extension scripts and styles into the WebView.
 *
 * Reads JS/CSS from the assets directory and evaluates them in the WebView
 * in the correct order, matching the original manifest.json content_scripts configuration.
 */
class InjectionEngine(private val context: Context) {

    companion object {
        private const val TAG = "BDInjection"
        private const val ASSET_BASE = "betterdungeon"

        private const val RUNTIME_MANIFEST = "$ASSET_BASE/runtime-manifest.json"
    }

    private data class RuntimeManifest(
        val earlyScripts: List<String>,
        val styles: List<String>,
        val scripts: List<String>
    )

    private var cachedRuntimeManifest: RuntimeManifest? = null

    private fun runtimeManifest(): RuntimeManifest {
        cachedRuntimeManifest?.let { return it }
        val json = context.assets.open(RUNTIME_MANIFEST).bufferedReader().use { it.readText() }
        val root = JSONObject(json)
        fun strings(name: String): List<String> {
            val values = root.getJSONArray(name)
            return List(values.length()) { index -> values.getString(index) }
        }
        return RuntimeManifest(
            earlyScripts = strings("earlyScripts"),
            styles = strings("styles"),
            scripts = strings("scripts")
        ).also { cachedRuntimeManifest = it }
    }

    // Cache loaded files to avoid re-reading from assets on every navigation
    private var cachedCss: String? = null
    private var cachedJs: String? = null

    /**
     * Install the caret-scroll guard before page JavaScript runs. This matters
     * for AI Dungeon because its viewport listeners are registered during app
     * bootstrap. The regular bundle also contains the script as a fallback for
     * older WebView providers without document-start injection.
     */
    fun installDocumentStartFix(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.w(TAG, "Document-start scripts unsupported; using page-finished fallback")
            return
        }

        val script = readAsset("$ASSET_BASE/utils/android-editable-scroll-fix.js")
        if (script == null) {
            Log.w(TAG, "Caret scroll guard asset not found")
            return
        }

        WebViewCompat.addDocumentStartJavaScript(
            webView,
            script,
            setOf("*")
        )
        Log.d(TAG, "Caret scroll guard installed at document start")
    }

    /**
     * Inject all BetterDungeon CSS and JS into the given WebView.
     * Should be called from WebViewClient.onPageFinished() for aidungeon.com pages.
     */
    fun inject(webView: WebView) {
        Log.i(TAG, "Injecting BetterDungeon into WebView...")

        // Inject CSS first (non-blocking, just adds <style> tags)
        injectCss(webView)

        // Then inject JS
        injectJs(webView)
    }

    /**
     * Inject ws-interceptor.js early into the WebView.
     * Should be called from WebViewClient.onPageStarted().
     */
    fun injectEarly(webView: WebView) {
        Log.i(TAG, "Injecting WebSocket interceptor early...")
        val files = runtimeManifest().earlyScripts
        for (file in files) {
            val js = readAsset("$ASSET_BASE/$file")
            if (js != null) {
                // Evaluate immediately for document-start style hooks.
                webView.evaluateJavascript(js, null)
                Log.d(TAG, "Early script injected: $file")
            } else {
                Log.w(TAG, "Failed to load early script: $file")
            }
        }
    }

    /**
     * Inject all CSS files as inline <style> blocks.
     */
    private fun injectCss(webView: WebView) {
        val css = getCombinedCss()
        if (css.isEmpty()) {
            Log.w(TAG, "No CSS to inject")
            return
        }

        // Escape for JavaScript string embedding
        val escapedCss = css
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "")

        val injection = """
            (function() {
                var existing = document.getElementById('better-dungeon-styles');
                if (existing) {
                    existing.textContent = '$escapedCss';
                    console.log('[BetterDungeon] CSS refreshed');
                    return;
                }
                var style = document.createElement('style');
                style.id = 'better-dungeon-styles';
                style.textContent = '$escapedCss';
                document.head.appendChild(style);
                console.log('[BetterDungeon] CSS injected');
            })();
        """.trimIndent()

        webView.evaluateJavascript(injection, null)
        Log.d(TAG, "CSS injected (${css.length} chars)")
    }

    /**
     * Inject all JS files concatenated together.
     */
    private fun injectJs(webView: WebView) {
        val js = getCombinedJs()
        if (js.isEmpty()) {
            Log.w(TAG, "No JS to inject")
            return
        }

        webView.evaluateJavascript(js) {
            Log.d(TAG, "JS injection complete")
        }
        Log.d(TAG, "JS injected (${js.length} chars)")
    }

    /**
     * Read and combine all CSS files from assets.
     */
    private fun getCombinedCss(): String {
        cachedCss?.let { return it }

        val combined = StringBuilder()
        for (file in runtimeManifest().styles) {
            val content = readAsset("$ASSET_BASE/$file")
            if (content != null) {
                combined.append("/* === $file === */\n")
                combined.append(content)
                combined.append("\n\n")
            } else {
                Log.w(TAG, "CSS file not found: $file")
            }
        }

        // Fix font face URLs in CSS — convert relative paths to absolute asset paths
        var result = combined.toString()
        result = fixFontUrls(result)

        cachedCss = result
        return result
    }

    /**
     * Read and combine all JS files from assets.
     */
    private fun getCombinedJs(): String {
        cachedJs?.let { return it }

        val combined = StringBuilder()
        combined.append("(function() {\n'use strict';\n\n")
        combined.append("if (window.__betterDungeonBundleInjected === true && window.betterDungeonInstance && window.betterDungeonInstance.destroyed !== true) {\n")
        combined.append("  console.log('[BetterDungeon] Bundle already injected; skipping duplicate injection');\n")
        combined.append("  return;\n")
        combined.append("}\n")
        combined.append("window.__betterDungeonBundleInjected = true;\n\n")

        for (file in runtimeManifest().scripts) {
            val content = readAsset("$ASSET_BASE/$file")
            if (content != null) {
                combined.append("// ═══ $file ═══\n")
                combined.append("try {\n")
                combined.append(content)
                combined.append("\n} catch(e) { console.error('[BetterDungeon] Error in $file:', e); }\n\n")
            } else {
                Log.w(TAG, "JS file not found: $file")
            }
        }

        combined.append("\nconsole.log('[BetterDungeon] All scripts injected successfully');\n")
        combined.append("})();")

        cachedJs = combined.toString()
        return cachedJs!!
    }

    /**
     * Fix font URLs in CSS by embedding font files as base64 data URIs.
     *
     * The WebView loads pages from https://play.aidungeon.com, so file:///
     * URLs are blocked by the browser security model. Inlining fonts as
     * data URIs sidesteps this entirely — the font data lives inside the
     * <style> block and needs no external fetch.
     */
    private fun fixFontUrls(css: String): String {
        return css.replace(
            Regex("""url\(['"]?([^'")]+\.(woff2?|ttf|eot))['"]?\)""")
        ) { match ->
            val filename = match.groupValues[1]
            val extension = match.groupValues[2]

            if (filename.startsWith("http") || filename.startsWith("file:") || filename.startsWith("data:")) {
                match.value // Leave absolute URLs alone
            } else {
                // Resolve asset path relative to the lucide font directory
                val assetPath = when {
                    filename.contains("/") -> "$ASSET_BASE/$filename"
                    else -> "$ASSET_BASE/fonts/lucide/$filename"
                }

                val mimeType = when (extension) {
                    "woff2" -> "font/woff2"
                    "woff"  -> "font/woff"
                    "ttf"   -> "font/ttf"
                    "eot"   -> "application/vnd.ms-fontobject"
                    else    -> "application/octet-stream"
                }

                val base64 = readAssetBase64(assetPath)
                if (base64 != null) {
                    "url('data:$mimeType;base64,$base64')"
                } else {
                    Log.w(TAG, "Font file not found for embedding: $assetPath")
                    match.value
                }
            }
        }
    }

    /**
     * Read a binary asset file and return its contents as a Base64-encoded string.
     */
    private fun readAssetBase64(path: String): String? {
        return try {
            val bytes = context.assets.open(path).use { it.readBytes() }
            Base64.encodeToString(bytes, Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read asset for base64 encoding: $path", e)
            null
        }
    }

    /**
     * Read a text file from assets.
     */
    private fun readAsset(path: String): String? {
        return try {
            val inputStream = context.assets.open(path)
            val reader = BufferedReader(InputStreamReader(inputStream))
            val content = reader.readText()
            reader.close()
            content
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read asset: $path", e)
            null
        }
    }

    /**
     * Clear cached files (e.g., for development/debugging).
     */
    fun clearCache() {
        cachedCss = null
        cachedJs = null
        cachedRuntimeManifest = null
    }
}
