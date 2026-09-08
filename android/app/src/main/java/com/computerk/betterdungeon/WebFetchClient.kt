package com.computerk.betterdungeon

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.IDN
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection
import kotlin.math.max
import kotlin.math.min

/** Native, policy-enforcing HTTPS transport used by Ultrascripts WebFetch. */
class WebFetchClient {

    companion object {
        private const val DEFAULT_TIMEOUT_MS = 15_000
        private const val MAX_TIMEOUT_MS = 30_000
        private const val DEFAULT_MAX_BODY_BYTES = 50_000
        private const val MAX_BODY_BYTES = 100_000
        private const val MAX_REDIRECTS = 5
        private const val MAX_URL_CHARS = 8_192
        private const val MAX_HEADER_COUNT = 20
        private const val MAX_HEADER_NAME_CHARS = 128
        private const val MAX_HEADER_VALUE_CHARS = 2_048
        private const val MAX_HEADER_TOTAL_CHARS = 8_192
        private val EXECUTOR = Executors.newFixedThreadPool(3)

        private val SAFE_METHODS = setOf("GET", "HEAD")
        private val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)
        private val BLOCKED_REQUEST_HEADERS = setOf(
            "accept-encoding", "authorization", "connection", "content-length", "cookie",
            "forwarded", "host", "origin", "proxy-authorization", "referer", "referrer",
            "te", "trailer", "transfer-encoding", "upgrade", "user-agent", "via",
            "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip"
        )
        private val BLOCKED_RESPONSE_HEADERS = setOf(
            "set-cookie", "set-cookie2", "authorization", "proxy-authorization"
        )
        private val HEADER_NAME_PATTERN = Regex("^[!#\\$%&'*+.^_`|~0-9A-Za-z-]+$")
        private val IPV4_PATTERN = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")
        private val NUMERIC_HOST_PATTERN = Regex("^(?:0x[0-9a-f]+|[0-9]+)$", RegexOption.IGNORE_CASE)
    }

    fun execute(requestJson: String, callback: (String) -> Unit) {
        EXECUTOR.execute {
            val envelope = try {
                val request = try {
                    JSONObject(requestJson)
                } catch (_: Exception) {
                    throw WebFetchException("invalid_args", "request must be a JSON object")
                }
                JSONObject().put("ok", true).put("data", perform(request))
            } catch (error: WebFetchException) {
                errorEnvelope(error.code, error.message ?: "WebFetch failed")
            } catch (error: SocketTimeoutException) {
                errorEnvelope("timeout", "WebFetch request timed out")
            } catch (error: Exception) {
                errorEnvelope("webfetch_failed", error.message ?: "WebFetch failed")
            }
            callback(envelope.toString())
        }
    }

    private fun perform(request: JSONObject): JSONObject {
        var url = validateUrl(request.optString("url", ""))
        val method = request.optString("method", "GET").uppercase(Locale.US)
        if (method !in SAFE_METHODS) {
            throw WebFetchException("invalid_args", "method '$method' is not supported; use GET or HEAD")
        }
        if (request.has("body") && !request.isNull("body")) {
            throw WebFetchException("invalid_args", "$method requests cannot include a body")
        }

        val rawHeaders = request.opt("headers")
        if (rawHeaders != null && rawHeaders !== JSONObject.NULL && rawHeaders !is JSONObject) {
            throw WebFetchException("invalid_args", "headers must be an object")
        }
        var headers = sanitizeHeaders(rawHeaders as? JSONObject)
        val timeoutMs = clamp(request.optDouble("timeoutMs", DEFAULT_TIMEOUT_MS.toDouble()), DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS)
        val maxBodyBytes = clamp(request.optDouble("maxBodyBytes", DEFAULT_MAX_BODY_BYTES.toDouble()), DEFAULT_MAX_BODY_BYTES, 1_024, MAX_BODY_BYTES)
        val deadline = System.currentTimeMillis() + timeoutMs
        val visited = linkedSetOf(url.toExternalForm())
        var redirectCount = 0

        while (true) {
            if (System.currentTimeMillis() >= deadline) {
                throw WebFetchException("timeout", "WebFetch request timed out after $timeoutMs ms")
            }
            val remainingMs = max(1L, deadline - System.currentTimeMillis()).toInt()
            val connection = (url.openConnection() as? HttpsURLConnection)
                ?: throw WebFetchException("scheme_blocked", "WebFetch only supports HTTPS URLs")
            try {
                connection.instanceFollowRedirects = false
                connection.requestMethod = method
                connection.connectTimeout = remainingMs
                connection.readTimeout = remainingMs
                connection.useCaches = false
                connection.defaultUseCaches = false
                headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }

                val status = connection.responseCode
                if (status in REDIRECT_STATUSES) {
                    val location = connection.getHeaderField("Location")
                        ?: throw WebFetchException("redirect_blocked", "Redirect response did not include a Location header")
                    if (redirectCount >= MAX_REDIRECTS) {
                        throw WebFetchException("redirect_limit", "WebFetch exceeded $MAX_REDIRECTS redirects")
                    }
                    val nextUrl = validateUrl(url.toURI().resolve(location).toString())
                    if (!visited.add(nextUrl.toExternalForm())) {
                        throw WebFetchException("redirect_loop", "WebFetch detected a redirect loop")
                    }
                    if (origin(nextUrl) != origin(url)) headers = emptyMap()
                    url = nextUrl
                    redirectCount++
                    continue
                }

                return shapeResponse(connection, url, method, maxBodyBytes, redirectCount)
            } finally {
                connection.disconnect()
            }
        }
    }

    private fun shapeResponse(
        connection: HttpsURLConnection,
        url: URL,
        method: String,
        maxBodyBytes: Int,
        redirectCount: Int
    ): JSONObject {
        val status = connection.responseCode
        val contentType = connection.getHeaderField("Content-Type") ?: ""
        if (!isTextContentType(contentType)) {
            throw WebFetchException(
                "content_type_blocked",
                "WebFetch only returns text-like content; received '${if (contentType.isBlank()) "unknown" else contentType}'"
            )
        }

        val responseHeaders = JSONObject()
        connection.headerFields.forEach { (name, values) ->
            val lowerName = name?.lowercase(Locale.US)
            if (lowerName != null && lowerName !in BLOCKED_RESPONSE_HEADERS) {
                responseHeaders.put(lowerName, values.orEmpty().joinToString(", "))
            }
        }

        val bodyResult = if (method == "HEAD") {
            BodyResult(ByteArray(0), 0, 0, false)
        } else {
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            if (stream == null) BodyResult(ByteArray(0), 0, 0, false)
            else stream.use { input ->
                val output = ByteArrayOutputStream(min(maxBodyBytes, 8_192))
                val buffer = ByteArray(8_192)
                var returned = 0
                var truncated = false
                while (returned < maxBodyBytes) {
                    val read = input.read(buffer, 0, min(buffer.size, maxBodyBytes - returned))
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    returned += read
                }
                if (returned >= maxBodyBytes && input.read() >= 0) truncated = true
                val declaredLength = connection.contentLengthLong
                BodyResult(
                    output.toByteArray(),
                    if (declaredLength > 0) declaredLength else returned.toLong(),
                    returned,
                    truncated || (declaredLength > returned)
                )
            }
        }

        return JSONObject()
            .put("url", url.toExternalForm())
            .put("redirected", redirectCount > 0)
            .put("redirectCount", redirectCount)
            .put("status", status)
            .put("statusText", connection.responseMessage ?: "")
            .put("ok", status in 200..299)
            .put("headers", responseHeaders)
            .put("contentType", contentType)
            .put("bodyEncoding", "text")
            .put("body", bodyResult.bytes.toString(Charsets.UTF_8))
            .put("bytes", bodyResult.totalBytes)
            .put("returnedBytes", bodyResult.returnedBytes)
            .put("truncated", bodyResult.truncated)
    }

    private fun validateUrl(rawValue: String): URL {
        val raw = rawValue.trim()
        if (raw.isEmpty()) throw WebFetchException("invalid_args", "url is required")
        if (raw.length > MAX_URL_CHARS) {
            throw WebFetchException("invalid_args", "url must not exceed $MAX_URL_CHARS characters")
        }
        val url = try {
            URI(raw).toURL()
        } catch (_: Exception) {
            throw WebFetchException("invalid_args", "url must be an absolute URL")
        }
        if (!url.protocol.equals("https", ignoreCase = true)) {
            throw WebFetchException("scheme_blocked", "WebFetch only supports HTTPS URLs")
        }
        if (!url.userInfo.isNullOrEmpty()) {
            throw WebFetchException("credentials_blocked", "URLs containing credentials are blocked")
        }

        val host = normalizeHost(url.host)
        if (host.isEmpty()) throw WebFetchException("invalid_args", "url hostname is required")
        if (host == "localhost" || host.endsWith(".localhost") || host == "local" || host.endsWith(".local")) {
            throw WebFetchException("host_blocked", "Host '${url.host}' is blocked")
        }
        if (NUMERIC_HOST_PATTERN.matches(host) || isBlockedIpLiteral(host)) {
            throw WebFetchException("host_blocked", "Host '${url.host}' is blocked")
        }
        return url
    }

    private fun sanitizeHeaders(raw: JSONObject?): Map<String, String> {
        if (raw == null) return emptyMap()
        val names = raw.keys().asSequence().toList()
        if (names.size > MAX_HEADER_COUNT) {
            throw WebFetchException("invalid_args", "headers must not contain more than $MAX_HEADER_COUNT entries")
        }

        val headers = linkedMapOf<String, String>()
        var totalChars = 0
        names.forEach { rawName ->
            val name = rawName.trim()
            if (name.isEmpty() || name.length > MAX_HEADER_NAME_CHARS || !HEADER_NAME_PATTERN.matches(name)) {
                throw WebFetchException("invalid_args", "header name '${if (name.isEmpty()) "(empty)" else name}' is invalid or too long")
            }
            val lower = name.lowercase(Locale.US)
            if (raw.isNull(rawName)) return@forEach

            val value = raw.opt(rawName)?.toString() ?: return@forEach
            if (value.length > MAX_HEADER_VALUE_CHARS || value.contains('\r') || value.contains('\n')) {
                throw WebFetchException("invalid_args", "header '$name' has an invalid or oversized value")
            }
            totalChars += name.length + value.length
            if (totalChars > MAX_HEADER_TOTAL_CHARS) {
                throw WebFetchException("invalid_args", "headers must not exceed $MAX_HEADER_TOTAL_CHARS combined characters")
            }
            if (lower in BLOCKED_REQUEST_HEADERS || lower.startsWith("sec-") || lower.startsWith("proxy-")) return@forEach
            headers[name] = value
        }
        return headers
    }

    private fun isBlockedIpLiteral(host: String): Boolean {
        val ipv4Match = IPV4_PATTERN.matchEntire(host)
        if (ipv4Match != null) {
            val rawParts = ipv4Match.groupValues.drop(1)
            if (rawParts.any { it.length > 1 && it.startsWith('0') }) return true
            val parts = rawParts.map { it.toIntOrNull() ?: return true }
            return ipv4IsBlocked(parts)
        }
        if (!host.contains(':')) return false

        val address = try {
            InetAddress.getByName(host)
        } catch (_: Exception) {
            throw WebFetchException("invalid_args", "url contains an invalid IPv6 host")
        }
        if (address is Inet4Address) return ipv4IsBlocked(address.address.map { it.toInt() and 0xff })
        if (address !is Inet6Address) return true
        val bytes = address.address
        val firstGroup = ((bytes[0].toInt() and 0xff) shl 8) or (bytes[1].toInt() and 0xff)
        val secondGroup = ((bytes[2].toInt() and 0xff) shl 8) or (bytes[3].toInt() and 0xff)
        val globalUnicast = (firstGroup and 0xe000) == 0x2000
        val protocolAssignments = firstGroup == 0x2001 && secondGroup < 0x0200
        val documentation =
            firstGroup == 0x2001 && secondGroup == 0x0db8
        val sixToFour = firstGroup == 0x2002
        val documentationV2 = firstGroup == 0x3fff && (secondGroup and 0xf000) == 0
        return !globalUnicast || protocolAssignments || documentation || sixToFour || documentationV2
    }

    private fun ipv4IsBlocked(parts: List<Int>): Boolean {
        if (parts.size != 4 || parts.any { it !in 0..255 }) return true
        val (a, b, c) = parts
        return a == 0 || a == 10 || a == 127 ||
            (a == 100 && b in 64..127) || (a == 169 && b == 254) ||
            (a == 172 && b in 16..31) || (a == 192 && b == 0 && c == 0) ||
            (a == 192 && b == 0 && c == 2) || (a == 192 && b == 88 && c == 99) ||
            (a == 192 && b == 168) || (a == 198 && b in 18..19) ||
            (a == 198 && b == 51 && c == 100) || (a == 203 && b == 0 && c == 113) || a >= 224
    }

    private fun normalizeHost(host: String): String {
        val unwrapped = host.lowercase(Locale.US).removePrefix("[").removeSuffix("]").removeSuffix(".")
        return if (unwrapped.contains(':')) unwrapped else try {
            IDN.toASCII(unwrapped).lowercase(Locale.US)
        } catch (_: Exception) {
            throw WebFetchException("invalid_args", "url contains an invalid hostname")
        }
    }

    private fun origin(url: URL): String {
        val port = if (url.port >= 0) url.port else 443
        return "https://${normalizeHost(url.host)}:$port"
    }

    private fun isTextContentType(contentType: String): Boolean {
        val lower = contentType.lowercase(Locale.US)
        return lower.isBlank() || lower.startsWith("text/") || lower.contains("/json") ||
            lower.contains("+json") || lower.contains("/xml") || lower.contains("+xml")
    }

    private fun clamp(value: Double, fallback: Int, minimum: Int, maximum: Int): Int {
        if (!value.isFinite()) return fallback
        return value.toInt().coerceIn(minimum, maximum)
    }

    private fun errorEnvelope(code: String, message: String): JSONObject = JSONObject()
        .put("ok", false)
        .put("error", JSONObject().put("code", code).put("message", message))

    private data class BodyResult(
        val bytes: ByteArray,
        val totalBytes: Long,
        val returnedBytes: Int,
        val truncated: Boolean
    )

    private class WebFetchException(val code: String, message: String) : Exception(message)
}
