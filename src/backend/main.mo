import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Float "mo:core/Float";
import List "mo:core/List";
import Int "mo:core/Int";
import Time "mo:core/Time";
import Order "mo:core/Order";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Map "mo:core/Map";
import Timer "mo:core/Timer";

import Outcall "http-outcalls/outcall";

actor {
  // Types

  type Float = Float.Float;
  var betIdCounter = 0;

  type Candle = {
    timestamp : Int;
    open : Float;
    high : Float;
    low : Float;
    close : Float;
    volume : Float;
  };

  type Bet = {
    id : Nat;
    timestamp : Int;
    streak : Nat;
    amount : Float;
    direction : Text;
    outcome : ?Text;
    resolved : Bool;
  };

  type BotConfig = {
    enabled : Bool;
    balance : Float;
    startingBalance : Float;
  };

  // Candles Storage

  let candles = List.empty<Candle>();

  // Persistent Bets Storage

  let bets = Map.empty<Nat, Bet>();

  // Sort Bets by Timestamp Descending
  module Bet {
    public func compare(a : Bet, b : Bet) : Order.Order {
      Int.compare(b.timestamp, a.timestamp);
    };
  };

  func getBetsList() : List.List<Bet> {
    let betArray = bets.values().toArray();
    let sorted = betArray.sort();
    // Since bets should be queried newest first, just return array directly.
    // Convert to List only if further in-place editing is needed.
    let betList = List.empty<Bet>();
    for (bet in sorted.values()) {
      betList.add(bet);
    };
    betList;
  };

  // Bot State
  var botConfig : BotConfig = {
    enabled = false;
    balance = 1000.0;
    startingBalance = 1000.0;
  };

  // Helper Functions

  func computeStreak() : Nat {
    var count = 0;
    for (candle in candles.values()) {
      if (candle.close > candle.open) {
        count += 1;
      } else {
        return count;
      };
    };
    count;
  };

  func getCurrentVolume() : Float {
    let currentCandle = candles.at(0);
    currentCandle.volume;
  };

  func placeBet(streak : Nat, amount : Float) : () {
    if (botConfig.balance < amount) {
      return;
    };

    let bet : Bet = {
      id = betIdCounter;
      timestamp = Time.now();
      streak;
      amount;
      direction = "red";
      outcome = null;
      resolved = false;
    };

    bets.add(betIdCounter, bet);
    botConfig := {
      botConfig with balance = botConfig.balance - amount;
    };
    betIdCounter += 1;
  };

  func shouldPlaceBet(streak : Nat, volume : Float) : Bool {
    streak >= 3 and volume > 0.0
  };

  func getBetAmount(streak : Nat) : Float {
    switch (streak) {
      case (3) { 50.0 };
      case (4) { 150.0 };
      case (5) { 300.0 };
      case (_) { 600.0 };
    };
  };

  func handleBet(curVolume : Float) : () {
    let streak = computeStreak();

    if (shouldPlaceBet(streak, curVolume)) {
      let amount = getBetAmount(streak);
      placeBet(streak, amount);
    };
  };

  func resolveBet() : () {
    let streak = computeStreak();
    let betId = betIdCounter - 1;
    let bet = bets.get(betId);

    switch (bet) {
      case (null) {};
      case (?bet) {
        let betWasGreen = (bet.direction == "red");
        let streakWasGreen = streak > 0;

        let outcome = if (betWasGreen == streakWasGreen) {
          botConfig := {
            botConfig with balance = botConfig.balance + (bet.amount * 2.0);
          };
          "win";
        } else {
          "loss";
        };

        let updatedBet = {
          bet with
          outcome = ?outcome;
          resolved = true;
        };
        bets.add(betId, updatedBet);
      };
    };
  };

  // Binance Candle Fetching

  func parseCandle(jsonVal : Blob) : Candle {
    Runtime.trap("Unreachable. No implementation of JSON value in Motoko. Parsing is done in frontend. Fetched data is decoded in frontend after tunnel through canister for now. ");
  };

  public query func transform(input : Outcall.TransformationInput) : async Outcall.TransformationOutput {
    Outcall.transform(input);
  };

  func fetchBinanceCandles() : async ?[Candle] {
    let url = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=10";

    let response = await Outcall.httpGetRequest(url, [], transform);

    Runtime.trap("Unreachable. Will not be fixed until Motoko offers JSON parsing functions for blobs (ICP-4631 MO-4901). Parsing in frontend is the solution for now. Request returned a string response to be decoded in frontend." # response.size().toText() # "character blob");
    // switch(Json.parseText(response)) {
    //   case(#Array(candleArray)) {
    //     let iter = candleArray.iterator();
    //     let candlesIter = iter.filterMap(
    //       func(json) {
    //         try {
    //           ?parseCandle(json);
    //         } catch (err) {
    //           null;
    //         };
    //       }
    //     );
    //     let candleArray = candlesIter.toArray();
    //     if (candleArray.size() == 0) {
    //       return null;
    //     };
    //     return ?candleArray;
    //   };
    //   case(null) {
    //     Runtime.trap("Failed to parse candle data");
    //   };
    //   case(_) {
    //     return null;
    //   };
    // };
  };

  // Polling/Timer

  public shared ({ caller }) func enableBot() : async () {
    botConfig := {
      botConfig with enabled = true;
    };
    ignore Timer.recurringTimer<system>(
      #seconds 900,
      func() : async () {
        await manualTick();
      },
    );
  };

  public shared ({ caller }) func disableBot() : async () {
    botConfig := {
      botConfig with enabled = false;
    };
  };

  public shared ({ caller }) func manualTick() : async () {
    if (not botConfig.enabled) {
      return;
    };

    switch (await fetchBinanceCandles()) {
      case (null) { Runtime.trap("Error: Could not fetch candles") };
      case (?newCandles) {
        candles.clear();
        for (candle in newCandles.values()) {
          candles.add(candle);
        };
        let currentVolume = getCurrentVolume();
        handleBet(currentVolume);
        resolveBet();
      };
    };
  };

  // Update Methods

  public shared ({ caller }) func setStartingBalance(balance : Float) : async () {
    botConfig := {
      botConfig with balance;
      startingBalance = balance;
    };
  };

  // Queries

  public query ({ caller }) func getCandles() : async [Candle] {
    candles.toArray();
  };

  public query ({ caller }) func getBets() : async [Bet] {
    let betList = getBetsList();
    betList.toArray();
  };

  public query ({ caller }) func getBotConfig() : async BotConfig {
    botConfig;
  };

  public query ({ caller }) func getBalance() : async Float {
    botConfig.balance;
  };

  public query ({ caller }) func getCurrentStreak() : async Nat {
    computeStreak();
  };
};
