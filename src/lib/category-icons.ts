import {
  Baby,
  Banknote,
  Car,
  Clapperboard,
  Gift,
  GraduationCap,
  HeartHandshake,
  HeartPulse,
  Home,
  Landmark,
  Package,
  PawPrint,
  PiggyBank,
  Plane,
  Shirt,
  Shield,
  ShoppingBag,
  Sparkles,
  Tag,
  UtensilsCrossed,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";

const RULES: [RegExp, LucideIcon][] = [
  [/mortgage|rent|house|home/i, Home],
  [/food|eat|grocer|restaurant|dining|coffee/i, UtensilsCrossed],
  [/car|auto|gas|fuel|toyota|dodge|vehicle|toll|parking/i, Car],
  [/health|medical|doctor|dental|pharmacy/i, HeartPulse],
  [/insur/i, Shield],
  [/electric|water|utility|utilities|power|heat/i, Zap],
  [/phone|internet|cell|mobile|wifi/i, Wifi],
  [/entertain|movie|game|magic|hobby|fun/i, Clapperboard],
  [/travel|vacation|flight|hotel|trip/i, Plane],
  [/pet|dog|cat|vet/i, PawPrint],
  [/child|kid|baby|daycare/i, Baby],
  [/educat|school|tuition|book|supplies/i, GraduationCap],
  [/cloth|apparel|shoe/i, Shirt],
  [/gift|present/i, Gift],
  [/charit|donat|tithe|church/i, HeartHandshake],
  [/invest|saving|retire|ira|401/i, PiggyBank],
  [/income|salary|paycheck|wage|bonus|refund/i, Wallet],
  [/shop|store|amazon|ebay/i, ShoppingBag],
  [/subscri|membership|recurring/i, Sparkles],
  [/tax|bank|fee|interest|loan/i, Landmark],
  [/cash|transfer|deposit/i, Banknote],
  [/package|shipping|postal/i, Package],
];

export function categoryIcon(name: string): LucideIcon {
  for (const [pattern, icon] of RULES) {
    if (pattern.test(name)) return icon;
  }
  return Tag;
}
