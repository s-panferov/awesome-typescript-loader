/**
 * Type declarations for Webpack runtime.
 */

interface WebpackRequireEnsureCallback {
    (req: WebpackRequire): void
}

interface WebpackRequire {
    (id: string): any;
    ensure(ids: string[], callback: WebpackRequireEnsureCallback): void;
}

declare var require: WebpackRequire;