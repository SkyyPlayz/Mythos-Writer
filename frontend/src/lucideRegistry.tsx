// Bundled Lucide icon set for SKY-194 (Iconize).
// Curated for fiction writing; kept small to limit bundle impact.
import type { LucideProps } from 'lucide-react';
import {
  Sword, Shield, Crown, Star, Heart, Flame, Zap, Globe,
  BookOpen, Book, ScrollText, FileText, Pen, Feather, Notebook,
  Map, MapPin, Compass, Mountain, Trees, Castle, Home, Landmark,
  User, Users, UserRound, Ghost, Skull, Eye, Fingerprint,
  Gem, Package, Key, Lock, Wand2, Scroll, Sparkles, Moon, Sun,
  Music, Image, Clock, Tag, Folder, Search, MessageSquare,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type LucideIconComponent = ComponentType<LucideProps>;

export const LUCIDE_ICONS: Record<string, LucideIconComponent> = {
  // Combat / adventure
  sword: Sword,
  shield: Shield,
  crown: Crown,
  star: Star,
  flame: Flame,
  zap: Zap,
  // Writing / documents
  'book-open': BookOpen,
  book: Book,
  'scroll-text': ScrollText,
  'file-text': FileText,
  pen: Pen,
  feather: Feather,
  notebook: Notebook,
  // World / place
  map: Map,
  'map-pin': MapPin,
  compass: Compass,
  mountain: Mountain,
  trees: Trees,
  castle: Castle,
  home: Home,
  landmark: Landmark,
  globe: Globe,
  // Characters / creatures
  user: User,
  users: Users,
  'user-round': UserRound,
  ghost: Ghost,
  skull: Skull,
  eye: Eye,
  fingerprint: Fingerprint,
  // Items / magic
  gem: Gem,
  package: Package,
  key: Key,
  lock: Lock,
  wand2: Wand2,
  scroll: Scroll,
  sparkles: Sparkles,
  heart: Heart,
  // Misc
  moon: Moon,
  sun: Sun,
  music: Music,
  image: Image,
  clock: Clock,
  tag: Tag,
  folder: Folder,
  search: Search,
  'message-square': MessageSquare,
};

export const LUCIDE_ICON_NAMES = Object.keys(LUCIDE_ICONS).sort();
