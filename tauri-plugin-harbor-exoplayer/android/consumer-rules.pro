# The player is reached from JavaScript through @JavascriptInterface;
# those members are entry points and must survive shrinking.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
