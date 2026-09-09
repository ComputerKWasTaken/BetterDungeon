package com.computerk.betterdungeon

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeManifestTest {
    @Test
    fun generatedManifestContainsEveryInjectionPhase() {
        val manifest = File(
            "build/generated/betterdungeonAssets/betterdungeon/runtime-manifest.json"
        )

        assertTrue("Gradle must generate the runtime manifest before tests", manifest.isFile)
        val content = manifest.readText()
        assertTrue(content.contains("\"earlyScripts\""))
        assertTrue(content.contains("\"styles\""))
        assertTrue(content.contains("\"scripts\""))
        assertTrue(content.contains("\"main.js\""))
        assertTrue(
            "Platform contract must be the first early script",
            content.indexOf("\"utils/platform.js\"") < content.indexOf("\"services/apollo-bridge.js\"")
        )

        val injectionSource = File(
            "src/main/java/com/computerk/betterdungeon/InjectionEngine.kt"
        ).readText()
        assertTrue(
            "Native platform configuration must precede the early-script loop",
            injectionSource.indexOf("window.__betterDungeonNativePlatformConfig") <
                injectionSource.indexOf("for (file in files)")
        )
    }
}
