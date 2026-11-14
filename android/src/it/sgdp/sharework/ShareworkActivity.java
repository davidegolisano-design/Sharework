package it.sgdp.sharework;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JsPromptResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;
import java.io.OutputStream;
import java.util.Locale;

public final class ShareworkActivity extends Activity {
    private static final String HOME = "https://davidegolisano-design.github.io/Sharework/";
    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final int OPEN_FILE = 1;
    private static final int SAVE_EXCEL = 2;
    private WebView web;
    private Button retry;
    private ValueCallback<Uri[]> filePicker;
    private byte[] excelFile;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout layout = new FrameLayout(this);
        layout.setBackgroundColor(Color.rgb(243, 245, 249));
        web = new WebView(this);
        layout.addView(web, new FrameLayout.LayoutParams(-1, -1));
        retry = new Button(this);
        boolean italian = "it".equals(Locale.getDefault().getLanguage());
        retry.setText(italian ? "Connessione non disponibile · Riprova" : "Offline · Try again");
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(v -> {
            retry.setVisibility(View.GONE);
            web.loadUrl(HOME);
        });
        layout.addView(retry, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " ShareworkAndroid/10");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isSharework(uri)) return false;
                if (request.isForMainFrame() && request.hasGesture() && "https".equals(uri.getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException ignored) {
                        showMessage("Nessun browser disponibile", "No browser available");
                    }
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) retry.setVisibility(View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (filePicker != null) filePicker.onReceiveValue(null);
                filePicker = callback;
                try {
                    startActivityForResult(params.createIntent(), OPEN_FILE);
                } catch (ActivityNotFoundException e) {
                    filePicker.onReceiveValue(null);
                    filePicker = null;
                }
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String value,
                    JsPromptResult result) {
                if (!"sharework:save-xlsx".equals(message)) return false;
                boolean accepted = isSharework(Uri.parse(url)) && view.getUrl() != null && isSharework(Uri.parse(view.getUrl()))
                        && saveExcel(value);
                result.confirm(accepted ? "OK" : "");
                return true;
            }
        });
        setContentView(layout);
        hideSystemBars();
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(HOME);
    }

    private static boolean isSharework(Uri uri) {
        String path = uri.getPath();
        return "https".equals(uri.getScheme()) && "davidegolisano-design.github.io".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && path != null && path.startsWith("/Sharework/");
    }

    private boolean saveExcel(String value) {
        if (excelFile != null || value == null || value.length() > 12_000_000) return false;
        try {
            JSONObject request = new JSONObject(value);
            String name = request.getString("name");
            if (!name.endsWith(".xlsx")) return false;
            byte[] data = Base64.decode(request.getString("data"), Base64.DEFAULT);
            if (data.length < 4 || data[0] != 'P' || data[1] != 'K') return false;
            excelFile = data;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(XLSX).putExtra(Intent.EXTRA_TITLE, name);
            startActivityForResult(intent, SAVE_EXCEL);
            return true;
        } catch (Exception e) {
            excelFile = null;
            return false;
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request == OPEN_FILE && filePicker != null) {
            filePicker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, intent));
            filePicker = null;
        }
        if (request == SAVE_EXCEL) {
            byte[] data = excelFile;
            excelFile = null;
            if (result != RESULT_OK || intent == null || intent.getData() == null || data == null) return;
            try (OutputStream stream = getContentResolver().openOutputStream(intent.getData())) {
                if (stream == null) throw new IllegalStateException();
                stream.write(data);
            } catch (Exception e) {
                showMessage("Impossibile salvare il file Excel", "Could not save the Excel file");
            }
        }
    }

    private void showMessage(String italian, String english) {
        Toast.makeText(this, "it".equals(Locale.getDefault().getLanguage()) ? italian : english,
                Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        web.invalidate();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) hideSystemBars();
    }

    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        web.saveState(state);
    }
}
