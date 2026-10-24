import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.voltius.app"
    signingConfigs {
        getByName("debug") {
            storeFile = file("$rootDir/../../../keystore/voltius-debug.keystore")
            storePassword = "voltius"
            keyAlias = "voltius-debug"
            keyPassword = "voltius"
        }
        // Release signing is supplied by CI via env vars (keystore decoded from a
        // GitHub secret). Absent locally → release config stays unconfigured and
        // the release buildType falls back below, so local debug builds are unaffected.
        create("release") {
            System.getenv("ANDROID_KEYSTORE_PATH")?.let { ksPath ->
                storeFile = file(ksPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.voltius.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // R8 shrinks and obfuscates the libraries (Play flags unobfuscated DEX).
            // Rust calls our Kotlin by name over JNI (VoltiusKeychain, VoltiusBiometric,
            // VoltiusTunnelService, ...), so proguard-rules.pro keeps com.voltius.app
            // whole; Tauri's own classes are kept by the rules its library ships.
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
                "proguard-tauri.pro",
            )
            // Only attach the release signing config when CI provided a keystore;
            // otherwise leave unsigned so a local `release` build still completes.
            if (System.getenv("ANDROID_KEYSTORE_PATH") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // Navy splash with the bolt, held until the first web paint (see SplashGate.kt).
    implementation("androidx.core:core-splashscreen:1.0.1")
    // Hardware-backed secret storage for the OS keychain (see VoltiusKeychain.kt).
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.biometric:biometric:1.1.0")
    // SAF tree writes for the SFTP download directory (see VoltiusDownloads.kt).
    implementation("androidx.documentfile:documentfile:1.0.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")