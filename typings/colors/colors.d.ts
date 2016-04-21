// Type definitions for Colors.js 0.6.0-1
// Project: https://github.com/Marak/colors.js
// Definitions by: Bart van der Schoor <https://github.com/Bartvds>
// Definitions: https://github.com/borisyankov/DefinitelyTyped

declare module "colors/safe" {
    export function setTheme(theme:any):any;

    export function black(text: string): string;
    export function red(text: string): string;
    export function green(text: string): string;
    export function yellow(text: string): string;
    export function blue(text: string): string;
    export function magenta(text: string): string;
    export function cyan(text: string): string;
    export function white(text: string): string;
    export function gray(text: string): string;
    export function grey(text: string): string;
}