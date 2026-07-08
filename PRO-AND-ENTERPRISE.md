# Theme Sync Native Override

Smart Mode is the public default: no Chrome warning, good enough for most sites.

Native Mode uses Chrome's debugger API for the most accurate color-scheme override. Chrome may show a debugging warning. If the warning is canceled, Theme Sync falls back to Smart Mode.

## Pro Companion

Close Chrome completely, then start it through:

```bat
launch-chrome-silent-debugger.cmd
```

That launches Chrome with:

```txt
--silent-debugger-extension-api
```

Chrome must be started with that flag before Native Mode can avoid the warning.

## Enterprise

Teams can force-install the extension with Chrome policy, then use Native Mode in managed environments. Start with Chrome Enterprise's `ExtensionInstallForcelist` policy.
