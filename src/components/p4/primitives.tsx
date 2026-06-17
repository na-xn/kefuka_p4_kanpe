import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Choice, Role, Judge } from "@/p4/types";
import { DEBUFF_ICON } from "@/p4/icons";

/** 加速度(止まる/動く)・呪詛(見る/見ない)は単一デバフなのでテキストから判定。 */
function actionIcon(text: string): string | null {
  if (text.includes("止まる") || text.includes("動く")) return DEBUFF_ICON.accel;
  if (text.includes("見ない") || text.includes("見る")) return DEBUFF_ICON.juso;
  return null;
}

/**
 * 行動テキストバー。`icon` を渡した場合はそのデバフアイコンを表示
 * （散開/頭割りや混沌は真偽で持つデバフが変わるため、担当アイコンを明示で渡す）。
 * 未指定なら加速度/呪詛のみテキストから自動判定。
 */
export function ActionBar({ text, icon }: { text: string | null; icon?: string | null }) {
  if (!text) {
    return (
      <div className="mt-1 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground/60">
        判定を選択…
      </div>
    );
  }
  const resolvedIcon = icon !== undefined ? icon : actionIcon(text);
  return (
    <div className="mt-1 flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-1.5 text-base font-bold leading-tight text-foreground">
      {resolvedIcon && (
        <img src={resolvedIcon} alt="" className="size-6 shrink-0 rounded-[3px]" draggable={false} />
      )}
      <span>{text}</span>
    </div>
  );
}

/** 真/偽トグル（真=青, 偽=赤） */
export function TruthToggle({
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

/** 役割の値ごとの「選択中」スタイル（雷=紫/水=水色/つなみ=水色/ほのお=赤/アラガン=黄/死の超越=紫） */
const ROLE_ON_CLASS: Record<string, string> = {
  rai: "data-[state=on]:bg-purple-600 data-[state=on]:text-white data-[state=on]:border-purple-600",
  mizu: "data-[state=on]:bg-sky-400 data-[state=on]:text-black data-[state=on]:border-sky-400",
  tsunami: "data-[state=on]:bg-sky-400 data-[state=on]:text-black data-[state=on]:border-sky-400",
  honoo: "data-[state=on]:bg-red-600 data-[state=on]:text-white data-[state=on]:border-red-600",
  aragan: "data-[state=on]:bg-yellow-400 data-[state=on]:text-black data-[state=on]:border-yellow-400",
  shi: "data-[state=on]:bg-purple-600 data-[state=on]:text-white data-[state=on]:border-purple-600",
  nashi: "data-[state=on]:bg-slate-500 data-[state=on]:text-white data-[state=on]:border-slate-500",
};

function roleItemClass(value: string): string {
  const on =
    ROLE_ON_CLASS[value] ??
    "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";
  return `${on} data-[state=on]:font-bold data-[state=off]:opacity-40`;
}

/** トグル選択肢の中身（デバフアイコン＋ラベル）。 */
function OptLabel({ icon, label }: { icon?: string; label: string }) {
  return (
    <>
      {icon && (
        <img src={icon} alt="" className="size-6 shrink-0 rounded-[3px]" draggable={false} />
      )}
      <span>{label}</span>
    </>
  );
}

/** 担当セレクタ（値ごとに色分け） */
export function RoleToggle({
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
      <ToggleGroupItem
        value={role.left.value}
        aria-label={role.left.label}
        className={roleItemClass(role.left.value)}
      >
        <OptLabel icon={role.left.icon} label={role.left.label} />
      </ToggleGroupItem>
      {role.mid && (
        <ToggleGroupItem
          value={role.mid.value}
          aria-label={role.mid.label}
          className={roleItemClass(role.mid.value)}
        >
          <OptLabel icon={role.mid.icon} label={role.mid.label} />
        </ToggleGroupItem>
      )}
      <ToggleGroupItem
        value={role.right.value}
        aria-label={role.right.label}
        className={roleItemClass(role.right.value)}
      >
        <OptLabel icon={role.right.icon} label={role.right.label} />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** 汎用の単一選択トグル（任意個の選択肢）。選択中は塗り＋太字、未選択は薄く。 */
export function SelectToggle({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; onClass?: string; icon?: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v)}
      variant="outline"
      size="sm"
      className="shrink-0"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          aria-label={o.label}
          className={`${
            o.onClass ??
            "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary"
          } data-[state=on]:font-bold data-[state=off]:opacity-40`}
        >
          <OptLabel icon={o.icon} label={o.label} />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** 真/偽トグルの入力行（ラベル＋トグル） */
export function TruthInputRow({
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
export function MarkerNote({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1.5 text-xs font-medium text-muted-foreground">
      {text}
    </div>
  );
}

/** 処理フローのステップ（縦タイムライン: 左に連結ライン＋番号ノード、右に内容） */
export function ProcessStep({
  index,
  name,
  children,
  last = false,
  highlight = false,
  icons,
}: {
  index: number;
  name: string;
  children: React.ReactNode;
  /** 最後のステップなら下方向の連結ラインを引かない */
  last?: boolean;
  /** 自分の担当ステップ（加速度・呪詛発生源）。枠を強調＋先頭に ★ */
  highlight?: boolean;
  /** このステップで処理するデバフのアイコン（名前の右に表示） */
  icons?: (string | null)[];
}) {
  return (
    <div className="flex gap-2.5">
      {/* レール（ノード＋連結ライン） */}
      <div className="flex flex-col items-center">
        <span
          className={`z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-2 ring-background ${
            highlight ? "bg-amber-400 text-black" : "bg-primary text-primary-foreground"
          }`}
        >
          {index}
        </span>
        {!last && <div className="my-0.5 w-0.5 flex-1 rounded bg-border" />}
      </div>
      {/* 内容（ブロックごとに枠＋下余白でギャップ） */}
      <div className={last ? "flex-1" : "flex-1 pb-3"}>
        <div
          className={`rounded-lg border bg-card/40 px-2 py-1.5 ${
            highlight ? "border-2 border-amber-400" : ""
          }`}
        >
          <div className="mb-1 flex items-center gap-1 text-[13px] font-bold leading-tight">
            {highlight && <span className="text-amber-400">★</span>}
            {icons
              ?.filter(Boolean)
              .map((src, i) => (
                <img
                  key={i}
                  src={src as string}
                  alt=""
                  className="size-6 shrink-0 rounded-[3px]"
                  draggable={false}
                />
              ))}
            <span>{name}</span>
          </div>
          <div className="flex flex-col gap-1.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
