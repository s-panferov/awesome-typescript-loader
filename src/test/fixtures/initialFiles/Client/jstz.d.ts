declare module 'jstz' {
    interface Timezone {
        name(): string;
    }

    export function determine(): Timezone;
}
