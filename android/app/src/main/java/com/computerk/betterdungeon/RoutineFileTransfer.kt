package com.computerk.betterdungeon

import android.net.Uri
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.io.ByteArrayOutputStream
import org.json.JSONObject

/** User-selected JSON documents only; no filesystem paths or broad permissions. */
class RoutineFileTransfer(
    private val activity: AppCompatActivity,
    private val webView: () -> WebView,
    private val allowedPage: (Uri) -> Boolean
) {
    private data class Request(val id: String, val url: String, val text: String?)
    private var pending: Request? = null
    private val maxBytes = 1024 * 1024
    private val openDocument = activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        completeDocument(uri, false)
    }
    private val createDocument = activity.registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        completeDocument(uri, true)
    }

    fun open(requestId: String) {
        if (!begin(requestId, null)) return
        try { openDocument.launch(arrayOf("application/json", "text/plain")) }
        catch (_: Exception) { failPending("The document picker could not be opened.") }
    }

    fun save(requestId: String, text: String) {
        if (text.toByteArray(Charsets.UTF_8).size > maxBytes) {
            reply(requestId, JSONObject().put("error", "The Routine file exceeds 1 MB."))
            return
        }
        try {
            val document = JSONObject(text)
            require(document.getInt("version") == 1)
            document.getJSONArray("routines")
        } catch (_: Exception) {
            reply(requestId, JSONObject().put("error", "Invalid Routine file."))
            return
        }
        if (!begin(requestId, text)) return
        try { createDocument.launch("BetterDungeon-Routines.json") }
        catch (_: Exception) { failPending("The save dialog could not be opened.") }
    }

    private fun begin(requestId: String, text: String?): Boolean {
        val url = webView().url ?: return false
        if (!requestId.matches(Regex("[a-zA-Z0-9_-]{1,100}")) || !allowedPage(Uri.parse(url))) return false
        if (pending != null) {
            reply(requestId, JSONObject().put("error", "Finish the current file operation first."))
            return false
        }
        pending = Request(requestId, url, text)
        return true
    }

    private fun completeDocument(uri: Uri?, saving: Boolean) {
        val request = pending ?: return
        if (uri == null) {
            pending = null
            reply(request.id, JSONObject().put("cancelled", true))
            return
        }
        Thread {
            val result = try {
                if (saving) {
                    activity.contentResolver.openOutputStream(uri, "wt")?.use { stream ->
                        stream.write(requireNotNull(request.text).toByteArray(Charsets.UTF_8))
                    } ?: error("No output stream")
                    JSONObject().put("text", "")
                } else {
                    val bytes = ByteArrayOutputStream()
                    activity.contentResolver.openInputStream(uri)?.use { stream ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = stream.read(buffer)
                            if (count < 0) break
                            if (bytes.size() + count > maxBytes) error("File too large")
                            bytes.write(buffer, 0, count)
                        }
                    } ?: error("No input stream")
                    JSONObject().put("text", bytes.toString("UTF-8"))
                }
            } catch (_: Exception) {
                JSONObject().put("error", "Could not ${if (saving) "save" else "read"} the Routine file. Choose a JSON file smaller than 1 MB.")
            }
            activity.runOnUiThread {
                if (pending === request) {
                    pending = null
                    if (webView().url == request.url) reply(request.id, result)
                }
            }
        }.start()
    }

    private fun failPending(message: String) {
        val request = pending ?: return
        pending = null
        reply(request.id, JSONObject().put("error", message))
    }

    private fun reply(requestId: String, result: JSONObject) {
        webView().evaluateJavascript(
            "window.__bdRoutineFileResult?.(${JSONObject.quote(requestId)}, $result);", null
        )
    }

    fun close() { pending = null }
}
