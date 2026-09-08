package com.computerk.betterdungeon

import android.util.Base64
import org.json.JSONObject
import java.net.SocketTimeoutException
import java.net.URI
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

/**
 * Cancellable HTTPS transport for BetterDungeon's configured AI providers.
 *
 * The WebView owns provider payload construction and response parsing so it can
 * stay source-compatible with the desktop extension. Native code only performs
 * the request and streams response bytes back across the JavaScript bridge.
 */
class AiTransportClient {

    companion object {
        private const val DEFAULT_TIMEOUT_MS = 120_000
        private const val MIN_TIMEOUT_MS = 5_000
        private const val MAX_TIMEOUT_MS = 180_000
        private const val MAX_REQUEST_BODY_BYTES = 1_000_000
        private const val MAX_HEADER_COUNT = 32
        private const val MAX_HEADER_CHARS = 16_384
        private const val MAX_URL_CHARS = 8_192
        private const val CHUNK_BYTES = 8_192
        private val HEADER_NAME_PATTERN = Regex("^[!#\\$%&'*+.^_`|~0-9A-Za-z-]+$")
        private val EXECUTOR = Executors.newFixedThreadPool(3)
    }

    private data class ActiveRequest(
        val cancelled: AtomicBoolean = AtomicBoolean(false),
        @Volatile var connection: HttpsURLConnection? = null
    )

    private val activeRequests = ConcurrentHashMap<String, ActiveRequest>()

    fun execute(requestJson: String, requestId: String, callback: (String) -> Unit) {
        val id = requestId.trim()
        if (id.isEmpty()) {
            callback(errorEvent("invalid_args", "AI transport requestId is required"))
            return
        }

        val active = ActiveRequest()
        if (activeRequests.putIfAbsent(id, active) != null) {
            callback(errorEvent("invalid_args", "AI transport requestId is already active"))
            return
        }

        EXECUTOR.execute {
            try {
                val request = try {
                    JSONObject(requestJson)
                } catch (_: Exception) {
                    throw AiTransportException("invalid_args", "AI transport request must be a JSON object")
                }
                perform(request, active, callback)
            } catch (_: RequestAbortedException) {
                callback(errorEvent("aborted", "AI request was aborted", retryable = false))
            } catch (_: SocketTimeoutException) {
                callback(errorEvent("timeout", "AI request timed out", retryable = true))
            } catch (error: AiTransportException) {
                callback(errorEvent(error.code, error.message ?: "AI transport failed", error.retryable))
            } catch (error: Exception) {
                if (active.cancelled.get()) {
                    callback(errorEvent("aborted", "AI request was aborted", retryable = false))
                } else {
                    callback(errorEvent("network_failed", error.message ?: "AI transport failed", retryable = true))
                }
            } finally {
                active.connection?.disconnect()
                activeRequests.remove(id, active)
            }
        }
    }

    fun cancel(requestId: String): Boolean {
        val active = activeRequests[requestId.trim()] ?: return false
        active.cancelled.set(true)
        active.connection?.disconnect()
        return true
    }

    fun cancelAll() {
        activeRequests.values.forEach { active ->
            active.cancelled.set(true)
            active.connection?.disconnect()
        }
    }

    private fun perform(
        request: JSONObject,
        active: ActiveRequest,
        callback: (String) -> Unit
    ) {
        checkNotAborted(active)
        val url = validateUrl(request.optString("url", ""))
        val method = request.optString("method", "POST").trim().uppercase(Locale.US)
        if (method != "POST") {
            throw AiTransportException("invalid_args", "AI transport only supports POST requests")
        }

        val body = request.optString("body", "")
        val bodyBytes = body.toByteArray(Charsets.UTF_8)
        if (bodyBytes.size > MAX_REQUEST_BODY_BYTES) {
            throw AiTransportException(
                "invalid_args",
                "AI request body must not exceed $MAX_REQUEST_BODY_BYTES bytes"
            )
        }
        val headers = sanitizeHeaders(request.optJSONObject("headers"))
        val timeoutMs = request.optInt("timeoutMs", DEFAULT_TIMEOUT_MS)
            .coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)

        val connection = (url.toURL().openConnection() as? HttpsURLConnection)
            ?: throw AiTransportException("invalid_args", "AI transport requires an HTTPS URL")
        active.connection = connection

        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.useCaches = false
            connection.defaultUseCaches = false
            connection.doOutput = true
            connection.setRequestProperty("Accept-Encoding", "identity")
            headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }

            checkNotAborted(active)
            connection.outputStream.use { output ->
                output.write(bodyBytes)
                output.flush()
            }
            checkNotAborted(active)

            val status = connection.responseCode
            callback(responseEvent(connection, status))

            val input = if (status >= 400) connection.errorStream else connection.inputStream
            if (input != null) {
                input.use { stream ->
                    val buffer = ByteArray(CHUNK_BYTES)
                    while (true) {
                        checkNotAborted(active)
                        val read = stream.read(buffer)
                        if (read < 0) break
                        if (read == 0) continue
                        val encoded = Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP)
                        callback(JSONObject().put("type", "chunk").put("data", encoded).toString())
                    }
                }
            }
            checkNotAborted(active)
            callback(JSONObject().put("type", "complete").toString())
        } finally {
            connection.disconnect()
            active.connection = null
        }
    }

    private fun validateUrl(rawValue: String): URI {
        val raw = rawValue.trim()
        if (raw.isEmpty()) throw AiTransportException("invalid_args", "AI request URL is required")
        if (raw.length > MAX_URL_CHARS) {
            throw AiTransportException("invalid_args", "AI request URL is too long")
        }
        val uri = try {
            URI(raw)
        } catch (_: Exception) {
            throw AiTransportException("invalid_args", "AI request URL is invalid")
        }
        if (!uri.isAbsolute || !uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) {
            throw AiTransportException("invalid_args", "AI transport only supports absolute HTTPS URLs")
        }
        if (uri.userInfo != null) {
            throw AiTransportException("invalid_args", "AI request URLs cannot contain credentials")
        }
        return uri
    }

    private fun sanitizeHeaders(raw: JSONObject?): Map<String, String> {
        if (raw == null) return emptyMap()
        val names = raw.keys().asSequence().toList()
        if (names.size > MAX_HEADER_COUNT) {
            throw AiTransportException("invalid_args", "AI request contains too many headers")
        }
        var totalChars = 0
        val headers = linkedMapOf<String, String>()
        names.forEach { rawName ->
            val name = rawName.trim()
            val value = raw.optString(rawName, "")
            if (!HEADER_NAME_PATTERN.matches(name) || value.contains('\r') || value.contains('\n')) {
                throw AiTransportException("invalid_args", "AI request contains an invalid header")
            }
            totalChars += name.length + value.length
            if (totalChars > MAX_HEADER_CHARS) {
                throw AiTransportException("invalid_args", "AI request headers are too large")
            }
            headers[name] = value
        }
        return headers
    }

    private fun responseEvent(connection: HttpsURLConnection, status: Int): String {
        val headers = JSONObject()
        connection.headerFields.forEach { (name, values) ->
            if (name != null) headers.put(name.lowercase(Locale.US), values.orEmpty().joinToString(", "))
        }
        return JSONObject()
            .put("type", "response")
            .put("status", status)
            .put("statusText", connection.responseMessage ?: "")
            .put("headers", headers)
            .toString()
    }

    private fun checkNotAborted(active: ActiveRequest) {
        if (active.cancelled.get()) throw RequestAbortedException()
    }

    private fun errorEvent(code: String, message: String, retryable: Boolean = false): String =
        JSONObject()
            .put("type", "error")
            .put(
                "error",
                JSONObject()
                    .put("code", code)
                    .put("message", message)
                    .put("retryable", retryable)
            )
            .toString()

    private class RequestAbortedException : Exception()

    private class AiTransportException(
        val code: String,
        message: String,
        val retryable: Boolean = false
    ) : Exception(message)
}
