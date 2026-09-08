package com.computerk.betterdungeon

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import android.util.Log
import java.util.Locale

/**
 * Wraps Android's [TextToSpeech] engine so the BetterDungeon Text-To-Speech
 * feature can narrate story output without relying on the WebView's
 * `speechSynthesis` API (which is effectively unavailable on Android WebView —
 * `getVoices()` returns an empty list on most devices).
 *
 * Lifecycle is owned by [MainActivity]: construct on `onCreate`, call
 * [shutdown] on `onDestroy`.
 */
class TextToSpeechManager(context: Context) {

    companion object {
        private const val TAG = "BDTTS"
        private const val UTTERANCE_ID = "betterdungeon_tts"
    }

    @Volatile
    private var ready: Boolean = false

    private val engine: TextToSpeech

    init {
        engine = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                try {
                    engine.language = Locale.getDefault()
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to set default language: ${e.message}")
                }
                ready = true
                Log.i(TAG, "TTS engine ready")
            } else {
                ready = false
                Log.w(TAG, "TTS engine init failed, status=$status")
            }
        }
    }

    fun isAvailable(): Boolean = ready

    /**
     * Returns a JSON array of available voices in the form expected by the
     * popup / feature:
     *   [ { "voiceURI": "...", "name": "...", "lang": "...", "default": bool, "localService": bool } ]
     */
    fun getVoicesJson(): String {
        if (!ready) return "[]"

        val voices: Collection<Voice> = try {
            engine.voices ?: emptyList()
        } catch (e: Exception) {
            Log.w(TAG, "getVoices failed: ${e.message}")
            return "[]"
        }

        val defaultVoiceName = try {
            engine.defaultVoice?.name
        } catch (e: Exception) {
            null
        }

        val sb = StringBuilder("[")
        var first = true
        for (voice in voices) {
            // Skip voices marked as needing network if we don't know they'll work
            if (voice.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) == true) continue

            if (!first) sb.append(",")
            first = false

            val name = voice.name ?: ""
            val lang = voice.locale?.toLanguageTag() ?: ""
            val isDefault = defaultVoiceName != null && defaultVoiceName == voice.name
            val localService = voice.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NETWORK_SYNTHESIS) != true

            sb.append("{")
            sb.append("\"voiceURI\":\"").append(escape(name)).append("\",")
            sb.append("\"name\":\"").append(escape(name)).append("\",")
            sb.append("\"lang\":\"").append(escape(lang)).append("\",")
            sb.append("\"default\":").append(isDefault).append(",")
            sb.append("\"localService\":").append(localService)
            sb.append("}")
        }
        sb.append("]")
        return sb.toString()
    }

    /**
     * Speak [text] using the given voice / rate / pitch / volume.
     *
     * - `voiceId`: one of the names returned by [getVoicesJson], or empty/"auto"
     *   to let the engine pick.
     * - `rate`, `pitch`: same ranges the Web Speech API uses (≈0.65–1.35).
     * - `volume`: 0.0–1.0; forwarded via [TextToSpeech.Engine.KEY_PARAM_VOLUME].
     * - `interrupt`: if true, stop any in-progress utterance before speaking.
     */
    fun speak(
        text: String,
        voiceId: String?,
        rate: Float,
        pitch: Float,
        volume: Float,
        interrupt: Boolean
    ): Boolean {
        if (!ready) return false
        if (text.isBlank()) return false

        try {
            // Voice selection. IMPORTANT: do NOT call setLanguage after setVoice — on
            // Google TTS (and others) that resets the voice back to the default for
            // the locale, which is why every non-default voice was sounding identical.
            val targetName = voiceId?.takeIf { it.isNotBlank() && it != "auto" }
            if (targetName != null) {
                val match = engine.voices?.firstOrNull { it.name == targetName }
                if (match != null) {
                    engine.voice = match
                } else {
                    // Fall back to default if the requested voice isn't installed.
                    engine.defaultVoice?.let { engine.voice = it }
                }
            } else {
                engine.defaultVoice?.let { engine.voice = it }
            }

            engine.setSpeechRate(clamp(rate, 0.1f, 3.0f))
            engine.setPitch(clamp(pitch, 0.1f, 3.0f))

            val params = Bundle().apply {
                putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, clamp(volume, 0f, 1f))
            }

            val queueMode = if (interrupt) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
            val result = engine.speak(text, queueMode, params, UTTERANCE_ID)
            return result == TextToSpeech.SUCCESS
        } catch (e: Exception) {
            Log.w(TAG, "speak failed: ${e.message}")
            return false
        }
    }

    fun stop() {
        if (!ready) return
        try {
            engine.stop()
        } catch (e: Exception) {
            Log.w(TAG, "stop failed: ${e.message}")
        }
    }

    fun shutdown() {
        try {
            engine.stop()
            engine.shutdown()
        } catch (e: Exception) {
            Log.w(TAG, "shutdown failed: ${e.message}")
        }
        ready = false
    }

    private fun clamp(value: Float, min: Float, max: Float): Float {
        if (value.isNaN()) return (min + max) / 2f
        return value.coerceIn(min, max)
    }

    private fun escape(s: String): String {
        return s
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }
}
