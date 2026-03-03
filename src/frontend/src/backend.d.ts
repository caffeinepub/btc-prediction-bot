import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface BotConfig {
    balance: Float;
    enabled: boolean;
    startingBalance: Float;
}
export interface TransformationOutput {
    status: bigint;
    body: Uint8Array;
    headers: Array<http_header>;
}
export interface Bet {
    id: bigint;
    resolved: boolean;
    direction: string;
    streak: bigint;
    timestamp: bigint;
    amount: Float;
    outcome?: string;
}
export interface TransformationInput {
    context: Uint8Array;
    response: http_request_result;
}
export interface Candle {
    low: Float;
    high: Float;
    close: Float;
    open: Float;
    volume: Float;
    timestamp: bigint;
}
export type Float = number;
export interface http_header {
    value: string;
    name: string;
}
export interface http_request_result {
    status: bigint;
    body: Uint8Array;
    headers: Array<http_header>;
}
export interface backendInterface {
    disableBot(): Promise<void>;
    enableBot(): Promise<void>;
    getBalance(): Promise<Float>;
    getBets(): Promise<Array<Bet>>;
    getBotConfig(): Promise<BotConfig>;
    getCandles(): Promise<Array<Candle>>;
    getCurrentStreak(): Promise<bigint>;
    manualTick(): Promise<void>;
    setStartingBalance(balance: Float): Promise<void>;
    transform(input: TransformationInput): Promise<TransformationOutput>;
}
