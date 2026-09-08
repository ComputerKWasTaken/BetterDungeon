import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import org.gradle.api.GradleException

plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.computerk.betterdungeon"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.computerk.betterdungeon"
        minSdk = 27
        targetSdk = 36
        versionCode = 4
        versionName = "2.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    sourceSets.getByName("main") {
        assets.srcDir(layout.buildDirectory.dir("generated/betterdungeonAssets").get().asFile)
    }
}

val betterDungeonRepositoryRoot = rootProject.projectDir.parentFile
val betterDungeonRuntimeFile = rootProject.file("betterdungeon-runtime.json")
val generatedBetterDungeonAssets = layout.buildDirectory.dir("generated/betterdungeonAssets")

@Suppress("UNCHECKED_CAST")
fun runtimeList(config: Map<String, Any?>, key: String): List<String> {
    return (config[key] as? List<*>)
        ?.map { it as? String ?: throw GradleException("$key entries must be strings") }
        ?: throw GradleException("Missing BetterDungeon runtime list: $key")
}

val generateBetterDungeonAssets by tasks.registering {
    group = "build"
    description = "Composes shared and Android-specific BetterDungeon WebView assets."

    inputs.file(betterDungeonRuntimeFile)
    inputs.dir(betterDungeonRepositoryRoot.resolve("android/web"))
    inputs.dir(betterDungeonRepositoryRoot.resolve("android/overrides"))
    val configuredRuntime = JsonSlurper().parse(betterDungeonRuntimeFile) as Map<String, Any?>
    val configuredTargets = (
        runtimeList(configuredRuntime, "earlyScripts") +
            runtimeList(configuredRuntime, "styles") +
            runtimeList(configuredRuntime, "scripts") +
            runtimeList(configuredRuntime, "resources")
        ).distinct()
    val configuredMobileFiles = runtimeList(configuredRuntime, "mobileFiles").toSet()
    val configuredOverrides = runtimeList(configuredRuntime, "overrides").toSet()
    inputs.files(configuredTargets.map { target ->
        when {
            target in configuredOverrides -> betterDungeonRepositoryRoot.resolve("android/overrides/$target")
            target in configuredMobileFiles -> betterDungeonRepositoryRoot.resolve("android/web/$target")
            else -> betterDungeonRepositoryRoot.resolve(target)
        }
    })
    outputs.dir(generatedBetterDungeonAssets)

    doLast {
        val parsed = JsonSlurper().parse(betterDungeonRuntimeFile) as? Map<String, Any?>
            ?: throw GradleException("betterdungeon-runtime.json must contain an object")
        val earlyScripts = runtimeList(parsed, "earlyScripts")
        val styles = runtimeList(parsed, "styles")
        val scripts = runtimeList(parsed, "scripts")
        val resources = runtimeList(parsed, "resources")
        val mobileFiles = runtimeList(parsed, "mobileFiles").toSet()
        val overrides = runtimeList(parsed, "overrides").toSet()
        val orderedTargets = earlyScripts + styles + scripts + resources
        val declaredTargets = orderedTargets.toSet()

        for ((name, paths) in mapOf(
            "earlyScripts" to earlyScripts,
            "styles" to styles,
            "scripts" to scripts,
            "resources" to resources,
        )) {
            if (paths.toSet().size != paths.size) throw GradleException("$name contains duplicate paths")
            if (paths.any { it.isBlank() || File(it).isAbsolute || it.split('/').contains("..") }) {
                throw GradleException("$name contains an unsafe path")
            }
        }
        if (declaredTargets.size != orderedTargets.size) {
            throw GradleException("Android runtime lists contain duplicate paths")
        }
        if (mobileFiles.size != runtimeList(parsed, "mobileFiles").size) {
            throw GradleException("mobileFiles contains duplicate paths")
        }
        if (overrides.size != runtimeList(parsed, "overrides").size) {
            throw GradleException("overrides contains duplicate paths")
        }

        fun filesBelow(root: File): Set<String> {
            if (!root.exists()) return emptySet()
            return root.walkTopDown()
                .filter { it.isFile }
                .map { it.relativeTo(root).invariantSeparatorsPath }
                .toSet()
        }

        val actualMobileFiles = filesBelow(betterDungeonRepositoryRoot.resolve("android/web"))
        val actualOverrides = filesBelow(betterDungeonRepositoryRoot.resolve("android/overrides"))
        if (actualMobileFiles != mobileFiles) {
            throw GradleException("android/web does not match mobileFiles; undeclared=${actualMobileFiles - mobileFiles}, missing=${mobileFiles - actualMobileFiles}")
        }
        if (actualOverrides != overrides) {
            throw GradleException("android/overrides does not match overrides; undeclared=${actualOverrides - overrides}, missing=${overrides - actualOverrides}")
        }
        if ((mobileFiles intersect overrides).isNotEmpty()) {
            throw GradleException("A runtime target cannot be both mobile-only and an override: ${mobileFiles intersect overrides}")
        }
        if (!declaredTargets.containsAll(mobileFiles + overrides)) {
            throw GradleException("Every mobile file and override must be included by a runtime list")
        }

        val outputRoot = generatedBetterDungeonAssets.get().asFile
        delete(outputRoot)
        outputRoot.mkdirs()
        val assetRoot = outputRoot.resolve("betterdungeon")
        assetRoot.mkdirs()

        fun sourceFor(target: String): File = when {
            target in overrides -> betterDungeonRepositoryRoot.resolve("android/overrides/$target")
            target in mobileFiles -> betterDungeonRepositoryRoot.resolve("android/web/$target")
            else -> betterDungeonRepositoryRoot.resolve(target)
        }

        for (target in (earlyScripts + styles + scripts + resources).distinct()) {
            val source = sourceFor(target)
            if (!source.exists()) throw GradleException("Missing BetterDungeon runtime source: $target ($source)")
            val destination = assetRoot.resolve(target)
            if (source.isDirectory) {
                copy {
                    from(source)
                    into(destination)
                }
            } else {
                destination.parentFile.mkdirs()
                source.copyTo(destination, overwrite = false)
            }
        }

        val generatedManifest = mapOf(
            "earlyScripts" to earlyScripts,
            "styles" to styles,
            "scripts" to scripts,
        )
        assetRoot.resolve("runtime-manifest.json").writeText(
            JsonOutput.prettyPrint(JsonOutput.toJson(generatedManifest)) + System.lineSeparator()
        )
    }
}

tasks.named("preBuild") {
    dependsOn(generateBetterDungeonAssets)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.webkit)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
