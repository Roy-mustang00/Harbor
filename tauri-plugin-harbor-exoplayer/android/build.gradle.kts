plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// Media3 is pinned once, here, for every module (stage-0 decision, recorded
// in the stage-2 progress log): 1.11.1 is the current stable line and its
// libraries are built against compileSdk 36, matching the generated app
// project (tauri-cli 2.10.1 template: AGP 8.11.0, Kotlin 1.9.25).
val media3Version = "1.8.1"

android {
    namespace = "app.harbor.exoplayer"
    compileSdk = 36

    defaultConfig {
        minSdk = 26

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
        // The generated app builds this module with Kotlin Gradle Plugin
        // 1.9.25 (tauri-cli 2.10.1 template), whose compiler cannot read the
        // Kotlin 2.2 metadata that Media3's dependency graph pulls in via
        // kotlin-stdlib 2.2.x ("Incompatible classes were found in
        // dependencies" on every plugin source file). Skip the metadata
        // version check so the 1.9 compiler accepts those classes.
        freeCompilerArgs += "-Xskip-metadata-version-check"
    }
}

dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.media3:media3-exoplayer:$media3Version")
    implementation("androidx.media3:media3-exoplayer-hls:$media3Version")
    implementation("androidx.media3:media3-exoplayer-dash:$media3Version")
    implementation("androidx.media3:media3-ui:$media3Version")

    // Constraints — unlike the resolutionStrategy force below — are exported
    // in this module's published metadata, so they reach consumers of the
    // plugin (the generated app module) and cap the stdlib version there
    // too, where Media3's graph would otherwise raise it to 2.2.10 and break
    // the app's Kotlin 1.9 compiler the same way it broke this module's.
    constraints {
        api("org.jetbrains.kotlin:kotlin-stdlib:1.9.24")
        api("org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.24")
        api("org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.24")
    }
}

// Keep this module's Kotlin stdlib in the KGP 1.9 era (see the compiler-flag
// note above): without this, Media3's graph resolves kotlin-stdlib to 2.2.x
// and its 2.2 metadata breaks the 1.9.25 compiler.
configurations.all {
    resolutionStrategy {
        force("org.jetbrains.kotlin:kotlin-stdlib:1.9.24")
        force("org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.24")
        force("org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.24")
    }
}
