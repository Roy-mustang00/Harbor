plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// Media3 is pinned once, here, for every module (stage-0 decision, recorded
// in the stage-2 progress log): 1.11.1 is the current stable line and its
// libraries are built against compileSdk 36, matching the generated app
// project (tauri-cli 2.10.1 template: AGP 8.11.0, Kotlin 1.9.25).
val media3Version = "1.11.1"

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
    }
}

dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.media3:media3-exoplayer:$media3Version")
    implementation("androidx.media3:media3-exoplayer-hls:$media3Version")
    implementation("androidx.media3:media3-exoplayer-dash:$media3Version")
    implementation("androidx.media3:media3-ui:$media3Version")
}
