package com.bananasend.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingWebPermissionRequest;

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (filePathCallback == null) return;
                Uri[] results = null;
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    Intent data = result.getData();
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        List<Uri> uris = new ArrayList<>();
                        for (int i = 0; i < count; i++) {
                            uris.add(data.getClipData().getItemAt(i).getUri());
                        }
                        results = uris.toArray(new Uri[0]);
                    } else if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            });

    private final ActivityResultLauncher<String> cameraPermissionLauncher =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
                if (pendingWebPermissionRequest != null) {
                    if (granted) {
                        pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
                    } else {
                        pendingWebPermissionRequest.deny();
                    }
                    pendingWebPermissionRequest = null;
                }
            });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.addJavascriptInterface(new AndroidBridge(), "BananaAndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

                try {
                    fileChooserLauncher.launch(Intent.createChooser(intent, "Select files to send"));
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean needsCamera = false;
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                            needsCamera = true;
                            break;
                        }
                    }

                    if (!needsCamera) {
                        request.grant(request.getResources());
                        return;
                    }

                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        pendingWebPermissionRequest = request;
                        cameraPermissionLauncher.launch(Manifest.permission.CAMERA);
                    }
                });
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    finish();
                }
            }
        });

        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    private static class DownloadStreamSession {
        final String fileName;
        final OutputStream outputStream;
        final Uri mediaStoreUri;

        DownloadStreamSession(String fileName, OutputStream outputStream, Uri mediaStoreUri) {
            this.fileName = fileName;
            this.outputStream = outputStream;
            this.mediaStoreUri = mediaStoreUri;
        }
    }

    public class AndroidBridge {
        private final Map<String, DownloadStreamSession> sessions = new ConcurrentHashMap<>();

        @JavascriptInterface
        public boolean isAndroidApp() {
            return true;
        }

        @JavascriptInterface
        public String beginFileSave(String fileName, String mimeType) {
            String safeName = (fileName == null || fileName.isEmpty())
                    ? "banana_file_" + System.currentTimeMillis()
                    : fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
            String resolvedMime = (mimeType == null || mimeType.isEmpty())
                    ? "application/octet-stream"
                    : mimeType;
            String token = UUID.randomUUID().toString();

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, resolvedMime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Banana Send");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);

                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "";
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) return "";
                    sessions.put(token, new DownloadStreamSession(safeName, os, uri));
                } else {
                    File dir = new File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                            "Banana Send"
                    );
                    if (!dir.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        dir.mkdirs();
                    }
                    File outFile = new File(dir, safeName);
                    OutputStream os = new FileOutputStream(outFile);
                    sessions.put(token, new DownloadStreamSession(safeName, os, null));
                }
                return token;
            } catch (IOException e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean appendFileChunk(String token, String base64Chunk) {
            DownloadStreamSession session = sessions.get(token);
            if (session == null || base64Chunk == null) return false;
            try {
                byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
                session.outputStream.write(bytes);
                return true;
            } catch (IOException e) {
                return false;
            }
        }

        @JavascriptInterface
        public void finishFileSave(String token, boolean success) {
            DownloadStreamSession session = sessions.remove(token);
            if (session == null) return;
            try {
                session.outputStream.flush();
                session.outputStream.close();
            } catch (IOException ignored) {
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && session.mediaStoreUri != null) {
                if (success) {
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(session.mediaStoreUri, done, null, null);
                } else {
                    getContentResolver().delete(session.mediaStoreUri, null, null);
                }
            }

            if (success) {
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        "Saved to Downloads/Banana Send: " + session.fileName,
                        Toast.LENGTH_SHORT
                ).show());
            }
        }
    }
}
