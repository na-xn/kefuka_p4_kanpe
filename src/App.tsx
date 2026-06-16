import { useEffect, useMemo, useRef, useState } from "react";
import { X, Lock, LockOpen, RotateCcw, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** "shin"=真(本当), "gi"=偽(嘘), ""=未選択 */
type Choice = "shin" | "gi" | "";
/** 担当セレクタの選択値（イベントごとに意味が変わる）/ "" = 未選択 */
type Role = string;

type State = Record<string, string>;

/** 1つの判定行の定義。resolve は揃った行動テキストを返す（未確定なら null）。 */
type Judge = {
  /** 判定の安定 id（状態キー） */
  id: string;
  /** 行ラベル */
  label: string;
  /** 担当セレクタ（任意）。指定時は別の状態キー `${id}__role` を使う */
  role?: { left: { value: Role; label: string }; right: { value: Role; label: string } };
  /** 真/偽トグルを出すか（デフォルト true） */
  truth?: boolean;
  /** 揃った行動テキストを返す。揃っていなければ null */
  resolve: (v: { truth: Choice; role: Role }) => string | null;
};

type EventDef = { id: string; name: string; judges: Judge[] };

/** 雷/水 × 真/偽 の散開・頭割りマッピング（①B / ③B 共通） */
function raiMizuAction(role: Role, truth: Choice): string | null {
  if (!role || !truth) return null;
  const spread = "💥 散開（1人）";
  const stack = "🤝 頭割り";
  if (role === "rai") return truth === "shin" ? spread : stack;
  // mizu
  return truth === "shin" ? stack : spread;
}

/** 炎/水 × 真/偽 のタケノコ・ドーナツマッピング（② / ④ 共通） */
function tsunamiHonooAction(role: Role, truth: Choice): string | null {
  if (!role || !truth) return null;
  if (role === "honoo") return truth === "shin" ? "🎍 タケノコ回避【炎】" : "🍩 ドーナツ＝中央で動かない";
  // tsunami(水)
  return truth === "shin" ? "🍩 ドーナツ＝中央で動かない" : "🎍 タケノコ回避【水】";
}

/** 呪詛の叫声: 真→見ない / 偽→見る */
function juso(truth: Choice): string | null {
  if (!truth) return null;
  return truth === "shin" ? "👁 見ない" : "👁 見る";
}

/** 加速度爆弾: 真→止まる / 偽→動く */
function accel(truth: Choice): string | null {
  if (!truth) return null;
  return truth === "shin" ? "🛑 止まる" : "🏃 動く";
}

const gcJudges = (suffix: string, late: boolean): Judge[] => [
  {
    id: `gc${suffix}_juso`,
    label: late ? "呪詛の叫声（遅）" : "呪詛の叫声（早）",
    resolve: ({ truth }) => juso(truth),
  },
  {
    id: `gc${suffix}_role`,
    label: "自分の担当",
    role: { left: { value: "rai", label: "雷" }, right: { value: "mizu", label: "水" } },
    resolve: ({ truth, role }) => raiMizuAction(role, truth),
  },
  {
    id: `gc${suffix}_accel`,
    label: `加速度爆弾（GC${suffix}で付与の人のみ）`,
    resolve: ({ truth }) => accel(truth),
  },
];

const tsunamiJudges = (suffix: string): Judge[] => [
  {
    id: `wave${suffix}_type`,
    label: "種類",
    role: { left: { value: "honoo", label: "炎(ほのお)" }, right: { value: "tsunami", label: "水(つなみ)" } },
    resolve: ({ truth, role }) => tsunamiHonooAction(role, truth),
  },
];

const EVENTS: EventDef[] = [
  { id: "gc1", name: "グランドクロス 1回目", judges: gcJudges("1", false) },
  { id: "wave1", name: "つなみ / ほのお 1回目", judges: tsunamiJudges("1") },
  { id: "gc2", name: "グランドクロス 2回目", judges: gcJudges("2", true) },
  { id: "wave2", name: "つなみ / ほのお 2回目", judges: tsunamiJudges("2") },
  {
    id: "gc3",
    name: "グランドクロス 3回目（生者の傷）",
    judges: [
      {
        id: "gc3_role",
        label: "担当",
        truth: false,
        role: {
          left: { value: "aragan", label: "アラガンフィールド" },
          right: { value: "shi", label: "死の超越" },
        },
        resolve: () => null,
      },
      {
        id: "gc3_mu",
        label: "無の氾濫",
        resolve: () => null,
      },
    ],
  },
  {
    id: "magic",
    name: "マジックチャージ → マジックアウト",
    judges: [
      { id: "magic_thunda", label: "もりもりサンダガ（記憶）", resolve: () => null },
      { id: "magic_blizza", label: "ひろげるブリザガ（記憶）", resolve: () => null },
      { id: "magic_out", label: "マジックアウト", resolve: () => null },
    ],
  },
];

type MenuState = { x: number; y: number } | null;

/** フェーズ: 判定入力 → 処理フロー */
type Phase = "input" | "process";

/** 判定入力フェーズで表示するイベント（①〜⑤。⑥マジックは出さない） */
const INPUT_EVENTS = EVENTS.filter((e) => e.id !== "magic");

export default function App() {
  const [state, setState] = useState<State>({});
  const [phase, setPhase] = useState<Phase>("input");
  const [opacity, setOpacity] = useState(1);
  const [locked, setLocked] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // メニュー外クリック / Esc で閉じる
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const w = 184;
    const h = 64;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - w - 8),
      y: Math.min(e.clientY, window.innerHeight - h - 8),
    });
  };

  const closeWindow = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      /* ブラウザプレビューでは無視 */
    }
  };

  const get = (key: string): string => state[key] ?? "";
  const set = (key: string, value: string) =>
    setState((s) => ({ ...s, [key]: value }));
  const resetAll = () => setState({});

  const dragProps = locked ? {} : { "data-tauri-drag-region": true };

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-transparent p-1.5"
      onContextMenu={openMenu}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-background shadow-lg"
        style={{ opacity }}
      >
        {/* ヘッダー兼ドラッグバー */}
        <div
          {...dragProps}
          className="flex h-8 shrink-0 items-center justify-between gap-2 border-b px-2"
        >
          {phase === "process" ? (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setPhase("input")}
              className="shrink-0"
            >
              <ChevronLeft />
              判定を編集
            </Button>
          ) : (
            <span {...dragProps} className="truncate text-xs font-bold select-none">
              🤡 絶妖星乱舞 P4 真偽判定
            </span>
          )}
          <div className="flex items-center gap-1">
            <Button variant="destructive" size="xs" onClick={resetAll}>
              <RotateCcw />
              ALLリセット
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLocked((l) => !l)}
              aria-label={locked ? "位置ロック解除" : "位置ロック"}
              title={locked ? "位置ロック中" : "位置ロック"}
            >
              {locked ? <Lock /> : <LockOpen />}
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={closeWindow} aria-label="閉じる">
              <X />
            </Button>
          </div>
        </div>

        {/* 本体（スクロール可能） */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {phase === "input" ? (
            <div className="flex flex-col gap-2">
              {INPUT_EVENTS.map((ev, idx) => (
                <EventCard
                  key={ev.id}
                  index={idx + 1}
                  event={ev}
                  get={get}
                  set={set}
                  inputPhase
                />
              ))}
              <Button
                variant="default"
                className="mt-1 h-11 w-full text-sm font-bold"
                onClick={() => setPhase("process")}
              >
                確定 → 処理フローへ →
              </Button>
            </div>
          ) : (
            <ProcessFlow get={get} set={set} />
          )}
        </div>
      </div>

      {/* 右クリックメニュー: 透過度スライダー */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"
          style={{ left: menu.x, top: menu.y, width: 184 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>透過度</span>
            <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
      )}
    </div>
  );
}

/** 処理フローのステップ枠（番号バッジ＋ステップ名＋子要素） */
function ProcessStep({
  index,
  name,
  children,
}: {
  index: number;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {index}
        </span>
        <span className="text-xs font-bold leading-tight">{name}</span>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

/** 真/偽トグルの入力行（ラベル＋トグル） */
function TruthInputRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Choice;
  onChange: (v: Choice) => void;
}) {
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">{label}</span>
        <TruthToggle value={value} onChange={onChange} />
      </div>
    </div>
  );
}

/** 全体攻撃などのマーカー表示 */
function MarkerNote({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1.5 text-xs font-medium text-muted-foreground">
      {text}
    </div>
  );
}

/** 処理フローフェーズ本体（記事タイムライン準拠の処理順） */
function ProcessFlow({
  get,
  set,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  // --- 状態の読み出し ---
  const gc3Role = get("gc3_role__role"); // "aragan" | "shi" | ""
  const gc3Mu = get("gc3_mu") as Choice; // 無の氾濫

  const thunda = get("magic_thunda") as Choice; // サンダガ記憶
  const blizza = get("magic_blizza") as Choice; // ブリザガ記憶
  const magicOut = get("magic_out") as Choice; // マジックアウト

  const gc1Role = get("gc1_role__role");
  const gc1RoleTruth = get("gc1_role") as Choice; // 雷/水 散開・頭割り判定
  const gc1Juso = get("gc1_juso") as Choice;
  const gc1Accel = get("gc1_accel") as Choice;

  const gc2Role = get("gc2_role__role");
  const gc2RoleTruth = get("gc2_role") as Choice;
  const gc2Juso = get("gc2_juso") as Choice;
  const gc2Accel = get("gc2_accel") as Choice;

  const wave1Role = get("wave1_type__role");
  const wave1Truth = get("wave1_type") as Choice;
  const wave2Role = get("wave2_type__role");
  const wave2Truth = get("wave2_type") as Choice;

  // --- 派生 ---
  // ① 生者の傷（GC3）: 既存 Gc3Body と同一ロジック
  const gc3Result = useMemo(() => {
    if (!gc3Role || !gc3Mu) return null;
    if (gc3Role === "aragan") {
      return gc3Mu === "shin"
        ? "🎯 異色に当たる（生きる）"
        : "🎯 同色に当たる（生きる）";
    }
    return gc3Mu === "shin"
      ? "🎯 同色に当たる（瀕死/死を回避）"
      : "🎯 異色に当たる（瀕死/死を回避）";
  }, [gc3Role, gc3Mu]);

  // ④ もりもりサンダガ＝記憶値で直接
  const thundaDirect: string | null = !thunda
    ? null
    : thunda === "shin"
    ? "⚡ 直線を踏まない"
    : "⚡ 直線を踏む";

  // ⑦ ひろげるブリザガ＝記憶値で直接
  const blizzaDirect: string | null = !blizza
    ? null
    : blizza === "shin"
    ? "❄ 扇を踏まない"
    : "❄ 扇を踏む";

  // ⑨ XNOR(記憶 × マジックアウト) 一致=本当→踏まない / 不一致=嘘→踏む
  const xnorTruth = (memory: Choice): "shin" | "gi" | null => {
    if (!memory || !magicOut) return null;
    return memory === magicOut ? "shin" : "gi";
  };
  const thundaFinal = xnorTruth(thunda);
  const blizzaFinal = xnorTruth(blizza);
  const thundaOutAction =
    thundaFinal === null
      ? null
      : thundaFinal === "shin"
      ? "⚡ 直線を踏まない"
      : "⚡ 直線を踏む";
  const blizzaOutAction =
    blizzaFinal === null
      ? null
      : blizzaFinal === "shin"
      ? "❄ 扇を踏まない"
      : "❄ 扇を踏む";

  const memLabel = (c: Choice) => (c === "shin" ? "真" : c === "gi" ? "偽" : "—");

  return (
    <div className="flex flex-col gap-2">
      {/* 1. 生者の傷（GC3）処理 */}
      <ProcessStep index={1} name="生者の傷（GC3）処理">
        {!gc3Role ? (
          <div className="rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
            判定入力で担当を選択してください
          </div>
        ) : (
          <div className="rounded-md border bg-card px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-xs font-semibold">
                無の氾濫{" "}
                <span className="text-[10px] text-muted-foreground">
                  （担当: {gc3Role === "aragan" ? "アラガン" : "死の超越"}）
                </span>
              </span>
              <TruthToggle value={gc3Mu} onChange={(v) => set("gc3_mu", v)} />
            </div>
            <ActionBar text={gc3Result} />
          </div>
        )}
      </ProcessStep>

      {/* 2. マジックチャージ（記憶） */}
      <ProcessStep index={2} name="マジックチャージ（記憶）">
        <TruthInputRow
          label="⚡ もりもりサンダガ（記憶）"
          value={thunda}
          onChange={(v) => set("magic_thunda", v)}
        />
        <TruthInputRow
          label="❄ ひろげるブリザガ（記憶）"
          value={blizza}
          onChange={(v) => set("magic_blizza", v)}
        />
        <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
          記憶 → ⚡サンダガ: <b className="text-foreground">{memLabel(thunda)}</b>
          {"　"}❄ブリザガ: <b className="text-foreground">{memLabel(blizza)}</b>
        </div>
      </ProcessStep>

      {/* 3. 水属性圧縮＋フォークライトニング＋加速度爆弾（GC1） */}
      <ProcessStep
        index={3}
        name="水属性圧縮＋フォークライトニング＋加速度爆弾（GC1）処理"
      >
        <ActionBar text={raiMizuAction(gc1Role, gc1RoleTruth)} />
        {accel(gc1Accel) && <ActionBar text={accel(gc1Accel)} />}
      </ProcessStep>

      {/* 4. もりもりサンダガ＋呪詛の叫声（GC1） */}
      <ProcessStep index={4} name="もりもりサンダガ＋呪詛の叫声（GC1）処理">
        <ActionBar text={thundaDirect} />
        <ActionBar text={juso(gc1Juso)} />
      </ProcessStep>

      {/* 5. どきどきアルテマ＋混沌（1回目） */}
      <ProcessStep index={5} name="どきどきアルテマ＋混沌（1回目）処理">
        <ActionBar text={tsunamiHonooAction(wave1Role, wave1Truth)} />
      </ProcessStep>

      {/* 6. 全体攻撃 */}
      <ProcessStep index={6} name="全体攻撃">
        <MarkerNote text="💥 全体攻撃（受けるだけ）" />
      </ProcessStep>

      {/* 7. ひろげるブリザガ＋水＋雷＋加速度（GC2） */}
      <ProcessStep index={7} name="ひろげるブリザガ＋水＋雷＋加速度（GC2）処理">
        <ActionBar text={blizzaDirect} />
        <ActionBar text={raiMizuAction(gc2Role, gc2RoleTruth)} />
        {accel(gc2Accel) && <ActionBar text={accel(gc2Accel)} />}
      </ProcessStep>

      {/* 8. 呪詛の叫声（GC2） */}
      <ProcessStep index={8} name="呪詛の叫声（GC2）処理">
        <ActionBar text={juso(gc2Juso)} />
      </ProcessStep>

      {/* 9. マジックアウト＋混沌（2回目） */}
      <ProcessStep index={9} name="マジックアウト＋混沌（2回目）処理">
        <TruthInputRow
          label="🎭 マジックアウト"
          value={magicOut}
          onChange={(v) => set("magic_out", v)}
        />
        {magicOut && (
          <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
            ⚡記憶 {memLabel(thunda)} × アウト {memLabel(magicOut)} →{" "}
            <b className="text-foreground">
              {thundaFinal === "shin" ? "本当" : thundaFinal === "gi" ? "嘘" : "—"}
            </b>
            {"　"}❄記憶 {memLabel(blizza)} × アウト {memLabel(magicOut)} →{" "}
            <b className="text-foreground">
              {blizzaFinal === "shin" ? "本当" : blizzaFinal === "gi" ? "嘘" : "—"}
            </b>
          </div>
        )}
        <ActionBar text={thundaOutAction} />
        <ActionBar text={blizzaOutAction} />
        <ActionBar text={tsunamiHonooAction(wave2Role, wave2Truth)} />
      </ProcessStep>

      {/* 10. どきどきアルテマ */}
      <ProcessStep index={10} name="どきどきアルテマ">
        <MarkerNote text="🔥 24.9% 以下で最終フェーズ" />
      </ProcessStep>
    </div>
  );
}

/** 行動テキストバー or プレースホルダ */
function ActionBar({ text }: { text: string | null }) {
  if (!text) {
    return (
      <div className="mt-1 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground/60">
        判定を選択…
      </div>
    );
  }
  return (
    <div className="mt-1 rounded-md bg-primary/15 px-2 py-1.5 text-base font-bold leading-tight text-foreground">
      {text}
    </div>
  );
}

/** 真/偽トグル（真=青, 偽=赤） */
function TruthToggle({
  value,
  onChange,
}: {
  value: Choice;
  onChange: (v: Choice) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => onChange(v as Choice)}
      variant="outline"
      size="sm"
      className="shrink-0"
    >
      <ToggleGroupItem
        value="shin"
        aria-label="真"
        className="data-[state=on]:bg-blue-600 data-[state=on]:text-white data-[state=on]:border-blue-600"
      >
        真
      </ToggleGroupItem>
      <ToggleGroupItem
        value="gi"
        aria-label="偽"
        className="data-[state=on]:bg-red-600 data-[state=on]:text-white data-[state=on]:border-red-600"
      >
        偽
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** 担当セレクタ（outline） */
function RoleToggle({
  role,
  value,
  onChange,
}: {
  role: NonNullable<Judge["role"]>;
  value: Role;
  onChange: (v: Role) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => onChange(v as Role)}
      variant="outline"
      size="sm"
      className="shrink-0"
    >
      <ToggleGroupItem value={role.left.value} aria-label={role.left.label}>
        {role.left.label}
      </ToggleGroupItem>
      <ToggleGroupItem value={role.right.value} aria-label={role.right.label}>
        {role.right.label}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** 1判定行（汎用） */
function JudgeRow({
  judge,
  get,
  set,
}: {
  judge: Judge;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const truth = (judge.truth === false ? "" : get(judge.id)) as Choice;
  const roleKey = `${judge.id}__role`;
  const role = judge.role ? get(roleKey) : "";
  const action = judge.resolve({ truth, role });

  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">{judge.label}</span>
        <div className="flex shrink-0 items-center gap-1">
          {judge.role && (
            <RoleToggle role={judge.role} value={role} onChange={(v) => set(roleKey, v)} />
          )}
          {judge.truth !== false && (
            <TruthToggle value={truth} onChange={(v) => set(judge.id, v)} />
          )}
        </div>
      </div>
      <ActionBar text={action} />
    </div>
  );
}

/** イベントカード */
function EventCard({
  index,
  event,
  get,
  set,
  inputPhase = false,
}: {
  index: number;
  event: EventDef;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
  /** 判定入力フェーズか（GC3 を担当選択のみに絞る） */
  inputPhase?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {index}
        </span>
        <span className="truncate text-xs font-bold">{event.name}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {event.id === "gc3" ? (
          inputPhase ? (
            <Gc3RolePicker get={get} set={set} />
          ) : (
            <Gc3Body get={get} set={set} />
          )
        ) : event.id === "magic" ? (
          <MagicBody get={get} set={set} />
        ) : (
          event.judges.map((j) => <JudgeRow key={j.id} judge={j} get={get} set={set} />)
        )}
      </div>
    </div>
  );
}

/** ⑤ GC3 の担当選択のみ（判定入力フェーズ用。無の氾濫は処理フェーズで入力） */
function Gc3RolePicker({
  get,
  set,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const roleKey = "gc3_role__role";
  const role = get(roleKey);
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">担当</span>
        <ToggleGroup
          type="single"
          value={role}
          onValueChange={(v) => set(roleKey, v)}
          variant="outline"
          size="sm"
          className="shrink-0"
        >
          <ToggleGroupItem value="aragan" aria-label="アラガンフィールド">
            アラガン
          </ToggleGroupItem>
          <ToggleGroupItem value="shi" aria-label="死の超越">
            死の超越
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}

/** ⑤ グランドクロス3回目（生者の傷） */
function Gc3Body({
  get,
  set,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const roleKey = "gc3_role__role";
  const role = get(roleKey); // "aragan" | "shi" | ""
  const mu = get("gc3_mu") as Choice; // 無の氾濫 真/偽

  const result = useMemo(() => {
    if (!role || !mu) return null;
    if (role === "aragan") {
      // 生きる＝ダメージを受けない
      return mu === "shin"
        ? "🎯 異色に当たる（生きる）"
        : "🎯 同色に当たる（生きる）";
    }
    // 死の超越: 瀕死になる＝ダメージを受ける
    return mu === "shin"
      ? "🎯 同色に当たる（瀕死/死を回避）"
      : "🎯 異色に当たる（瀕死/死を回避）";
  }, [role, mu]);

  return (
    <>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">担当</span>
          <ToggleGroup
            type="single"
            value={role}
            onValueChange={(v) => set(roleKey, v)}
            variant="outline"
            size="sm"
            className="shrink-0"
          >
            <ToggleGroupItem value="aragan" aria-label="アラガンフィールド">
              アラガン
            </ToggleGroupItem>
            <ToggleGroupItem value="shi" aria-label="死の超越">
              死の超越
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">無の氾濫</span>
          <TruthToggle value={mu} onChange={(v) => set("gc3_mu", v)} />
        </div>
        <ActionBar text={result} />
      </div>
    </>
  );
}

/** ⑥ マジックチャージ → マジックアウト（XNOR 解決） */
function MagicBody({
  get,
  set,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const thunda = get("magic_thunda") as Choice; // 記憶
  const blizza = get("magic_blizza") as Choice; // 記憶
  const out = get("magic_out") as Choice; // マジックアウト

  /** 記憶 と アウト が一致(XNOR)なら本当 / 不一致なら嘘 */
  const finalTruth = (memory: Choice): "shin" | "gi" | null => {
    if (!memory || !out) return null;
    return memory === out ? "shin" : "gi";
  };

  const thundaFinal = finalTruth(thunda);
  const blizzaFinal = finalTruth(blizza);

  const thundaAction =
    thundaFinal === null
      ? null
      : thundaFinal === "shin"
      ? "⚡ 直線を踏まない"
      : "⚡ 直線を踏む";
  const blizzaAction =
    blizzaFinal === null
      ? null
      : blizzaFinal === "shin"
      ? "❄ 扇を踏まない"
      : "❄ 扇を踏む";

  const memLabel = (c: Choice) => (c === "shin" ? "真" : c === "gi" ? "偽" : "—");
  const finLabel = (f: "shin" | "gi" | null) =>
    f === "shin" ? "本当" : f === "gi" ? "嘘" : "—";

  return (
    <>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">⚡ もりもりサンダガ（記憶）</span>
          <TruthToggle value={thunda} onChange={(v) => set("magic_thunda", v)} />
        </div>
      </div>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">❄ ひろげるブリザガ（記憶）</span>
          <TruthToggle value={blizza} onChange={(v) => set("magic_blizza", v)} />
        </div>
      </div>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">🎭 マジックアウト</span>
          <TruthToggle value={out} onChange={(v) => set("magic_out", v)} />
        </div>
        {/* 記憶値・最終結果のサマリ（マジックアウト後に表示） */}
        {out && (
          <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
            <span>
              ⚡記憶 {memLabel(thunda)} → 結果{" "}
              <b className="text-foreground">{finLabel(thundaFinal)}</b>
            </span>
            <span>
              ❄記憶 {memLabel(blizza)} → 結果{" "}
              <b className="text-foreground">{finLabel(blizzaFinal)}</b>
            </span>
          </div>
        )}
        <ActionBar text={thundaAction} />
        <ActionBar text={blizzaAction} />
      </div>
    </>
  );
}
