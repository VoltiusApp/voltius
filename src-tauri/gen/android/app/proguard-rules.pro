# Release builds run R8 (see build.gradle.kts).

# Rust looks up these classes and methods by name over JNI, and the WebView reaches
# some through @JavascriptInterface: R8 must not rename or remove any of them.
-keep class com.voltius.app.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# Readable stack traces in Play crash reports (the mapping file is uploaded with the AAB).
-renamesourcefileattribute SourceFile

# Tink (via androidx.security:security-crypto) references compile-only annotations.
-dontwarn javax.annotation.Nullable
-dontwarn javax.annotation.concurrent.GuardedBy
