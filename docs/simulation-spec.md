# シミュレーションモード仕様（Phase 1: 純ロジック）

絶妖星乱舞 P4 真偽判定カンペの「シミュレーションモード」。Phase 1 は**純粋な決定的ロジックのみ**で、
UI・バックエンド・ネットワークは含まない。実装は `src/p4/simulation.ts`、テストは `src/p4/simulation.test.ts`。

## 1. 役割・真偽モデル

- **Truth** = `"shin"`（ほんと）/ `"gi"`（うそ）。
- **GcRole**（GC1/GC2 の役割）= `"mizu"`（水）/ `"rai"`（雷）/ `"shisen"`（視線）/ `"mushoku"`（無職）。
  - `mizu` / `rai` は「水雷系」、`shisen` / `mushoku` は「加速度系」。
- **Gc3Role**（GC3 の役割）= `"aragan"`（アラガンフィールド＝生存）/ `"shi"`（死の超越＝死亡）。
- **WaveType**（波状攻撃の属性）= `"honoo"`（炎）/ `"tsunami"`（水）。

レイドは 8 人（`seat` 0..7、一意）。

## 2. 各 GC の構成

8 人に対し以下を満たすよう乱数配置する（注入可能な `() => number` の RNG で決定的）。

- **GC1**: `mizu`×2 / `rai`×2 / `shisen`×2 / `mushoku`×2（2/2/2/2）。
- **GC2（スワップ）**: GC1 で水雷だった 4 人は GC2 で加速度系に、GC1 で加速度系だった 4 人は GC2 で水雷に
  入れ替わる。サブ役割もそれぞれ 2/2 に割る結果、GC2 も `mizu`×2 / `rai`×2 / `shisen`×2 / `mushoku`×2 になる。
  - 不変条件: 各プレイヤーは GC1/GC2 のちょうど一方で水雷、他方で加速度系。
- **GC3**: `aragan`×4 / `shi`×4（4/4）。

## 3. 真偽・波のルール

- `gc1Truth` / `gc2Truth` / `wave1Truth` / `wave2Truth` / `thundaTruth` / `blizzaTruth`: 各々ランダムな `shin`/`gi`。
  GC のキャスト色真偽は全員共通（`gc1Truth` がその GC の水雷/加速度/視線の挙動を一括で決める）。
- `wave1Type`: ランダムに `honoo`/`tsunami`。
- `wave2Type`: 必ず `wave1Type` の**逆属性**。
- `gc1WaterEarly`: ランダムな真偽値。`true` のとき GC1 側の水雷が「早」（＝GC2 側の水雷が「遅」）。

## 4. タイミングについて（実戦タイム）

Phase 1 は配分とマッピングのみで、各イベントをタイムライン上に**スケジューリングしない**。
処理順・実戦タイムへの割り当ては Phase 3 で参照フロー（reference fight timeline）に沿って行う。
Phase 1 が扱う唯一のタイミング情報は `gc1WaterEarly`（水雷の早/遅）で、これは `toMinState` の
`waterWhen` 導出にのみ用いる。

## 5. `toMinState(setup, seat)` マッピング

ある席のプレイヤー割当を、既存ミニマムモードの `MinState`（`INITIAL_MIN` のキー集合）へ変換する。
返すキーは厳密に次の 10 個のみ:

| キー         | 導出                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| `waterType`  | 水雷である GC の役割が `rai` → `"rai"`、それ以外 → `"mizu"`                                |
| `waterGC`    | 水雷を持つ GC が GC1 → `"1"` / GC2 → `"2"`                                                |
| `waterWhen`  | `waterGC==="1"` → `gc1WaterEarly ? "haya" : "oso"` / `waterGC==="2"` → `gc1WaterEarly ? "oso" : "haya"` |
| `shisen`     | 加速度系の役割が `shisen` → `"yes"`、`mushoku` → `"no"`                                   |
| `gc1`        | `setup.gc1Truth`                                                                          |
| `gc2`        | `setup.gc2Truth`                                                                          |
| `honoo`      | 炎(honoo) だった波の真偽（`wave1Type`/`wave2Type` と各真偽から）                          |
| `tsunami`    | 水(tsunami) だった波の真偽                                                                |
| `thunda`     | `setup.thundaTruth`                                                                       |
| `blizza`     | `setup.blizzaTruth`                                                                       |

- 各プレイヤーは GC1/GC2 のちょうど一方で水雷、他方で加速度系である前提に依存する
  （違反時は例外を投げる）。
- 余分なキーは生成しない。`gc1`/`gc2`/`honoo`/`tsunami`/`thunda`/`blizza` はレイド全体で共通のため、
  同一 `setup` の全 8 席で一致する。
