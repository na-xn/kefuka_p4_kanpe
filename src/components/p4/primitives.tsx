import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Choice, Role, Judge } from "@/p4/types";

/** 行動テキストバー or プレースホルダ */
export function ActionBar({ text }: { text: string | null }) {
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
        {role.left.label}
      </ToggleGroupItem>
      {role.mid && (
        <ToggleGroupItem
          value={role.mid.value}
          aria-label={role.mid.label}
          className={roleItemClass(role.mid.value)}
        >
          {role.mid.label}
        </ToggleGroupItem>
      )}
      <ToggleGroupItem
        value={role.right.value}
        aria-label={role.right.label}
        className={roleItemClass(role.right.value)}
      >
        {role.right.label}
      </ToggleGroupItem>
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
}: {
  index: number;
  name: string;
  children: React.ReactNode;
  /** 最後のステップなら下方向の連結ラインを引かない */
  last?: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      {/* レール（ノード＋連結ライン） */}
      <div className="flex flex-col items-center">
        <span className="z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground ring-2 ring-background">
          {index}
        </span>
        {!last && <div className="my-0.5 w-0.5 flex-1 rounded bg-border" />}
      </div>
      {/* 内容（ブロックごとに枠＋下余白でギャップ） */}
      <div className={last ? "flex-1" : "flex-1 pb-3"}>
        <div className="rounded-lg border bg-card/40 px-2 py-1.5">
          <div className="mb-1 text-[13px] font-bold leading-tight">{name}</div>
          <div className="flex flex-col gap-1.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
