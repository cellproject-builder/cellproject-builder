import { forwardRef, type SVGProps } from 'react';
import {
  Accessibility, Activity, Archive, ArrowDown, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp,
  Backpack, Badge, Blend, BookOpen, Bookmark, Bot, Box, Boxes, Calendar, Camera, ChartColumn,
  ChartPie, Check, ChevronDown, ChevronRight, Circle, CircleCheck, CircleDot, Clock, Cloud,
  Code, Columns3, Compass, Component, Eraser, File, FileText, Folder, FolderOpen, Globe,
  Hand, Headphones, Heart, Highlighter, History, House, IdCard, Image, Keyboard, LassoSelect,
  Layers, LayoutDashboard, Link, List, ListChecks, LockKeyhole, Mail, MapPin, Maximize, Menu,
  MessageCircle, Minimize, Minus, Monitor, Moon, MousePointer2, Move, Network, NotebookPen, Package,
  PanelLeftClose, PanelLeftOpen, Pen, Pencil, PencilLine, PenTool, Pin, Plus, Redo2, RefreshCw,
  Rocket, Ruler, Scissors, Search, Send, Settings, Share2, Shield, SlidersHorizontal,
  Smartphone, Smile, Star, StickyNote, Sun, Table, Target, Timer, Trash2, TriangleAlert, Type,
  Undo2, Upload, User, Video, Volume2, WandSparkles, X, Zap, Laptop, type LucideIcon,
} from 'lucide-react';

export type SoftIconProps = SVGProps<SVGSVGElement> & { size?: number; title?: string };

/** A single stroke weight and rounded family; SVG attributes and refs stay native. */
function softIcon(Glyph: LucideIcon) {
  const Icon = forwardRef<SVGSVGElement, SoftIconProps>(function SoftIcon({
    size = 18, width = size, height = size, strokeWidth = 1.7, title, children, ...props
  }, ref) {
    const labelled = title || children || props['aria-label'] || props['aria-labelledby'] || props.role === 'img';
    return <Glyph ref={ref} width={width} height={height} strokeWidth={strokeWidth}
      aria-hidden={labelled ? undefined : true} {...props}>
      {title && <title>{title}</title>}{children}
    </Glyph>;
  });
  Icon.displayName = `Soft${Glyph.displayName ?? 'Icon'}`;
  return Icon;
}

// Stable aliases keep existing callers and persisted project icon IDs compatible.
export const AccessibilityIcon = softIcon(Accessibility);
export const ActivityLogIcon = softIcon(Activity);
export const ArchiveIcon = softIcon(Archive);
export const ArrowDownIcon = softIcon(ArrowDown);
export const ArrowLeftIcon = softIcon(ArrowLeft);
export const ArrowRightIcon = softIcon(ArrowRight);
export const ArrowUpIcon = softIcon(ArrowUp);
export const AvatarIcon = softIcon(User);
export const BackpackIcon = softIcon(Backpack);
export const BadgeIcon = softIcon(Badge);
export const BarChartIcon = softIcon(ChartColumn);
export const BookmarkIcon = softIcon(Bookmark);
export const BoxIcon = softIcon(Package);
export const CalendarIcon = softIcon(Calendar);
export const CameraIcon = softIcon(Camera);
export const CardStackIcon = softIcon(StickyNote);
export const ChatBubbleIcon = softIcon(MessageCircle);
export const CheckIcon = softIcon(Check);
export const CheckCircledIcon = softIcon(CircleCheck);
export const ChevronDownIcon = softIcon(ChevronDown);
export const ChevronRightIcon = softIcon(ChevronRight);
export const CircleIcon = softIcon(Circle);
export const ClockIcon = softIcon(Clock);
export const CloseIcon = softIcon(X);
export const CloudIcon = softIcon(Cloud);
export const CodeIcon = softIcon(Code);
export const CompassIcon = softIcon(Compass);
export const Component1Icon = softIcon(Component);
export const Component2Icon = softIcon(Boxes);
export const CornersIcon = softIcon(Maximize);
export const CountdownTimerIcon = softIcon(Timer);
export const CubeIcon = softIcon(Box);
export const CursorArrowIcon = softIcon(MousePointer2);
export const DashboardIcon = softIcon(LayoutDashboard);
export const DesktopIcon = softIcon(Monitor);
export const DimensionsIcon = softIcon(Ruler);
export const EnterFullScreenIcon = CornersIcon;
export const EnvelopeClosedIcon = softIcon(Mail);
export const EraserIcon = softIcon(Eraser);
export const ExclamationTriangleIcon = softIcon(TriangleAlert);
export const ExitFullScreenIcon = softIcon(Minimize);
export const FaceIcon = softIcon(Smile);
export const FileIcon = softIcon(File);
export const FileTextIcon = softIcon(FileText);
export const FolderIcon = softIcon(Folder);
export const FolderOpenIcon = softIcon(FolderOpen);
export const FountainPenIcon = softIcon(PenTool);
export const GearIcon = softIcon(Settings);
export const GlobeIcon = softIcon(Globe);
export const GridIcon = DashboardIcon;
export const Half2Icon = softIcon(CircleDot);
export const HandIcon = softIcon(Hand);
export const HeadphonesIcon = softIcon(Headphones);
export const HeartIcon = softIcon(Heart);
export const HighlighterIcon = softIcon(Highlighter);
export const HistoryIcon = softIcon(History);
export const HomeIcon = softIcon(House);
export const IdCardIcon = softIcon(IdCard);
export const ImageIcon = softIcon(Image);
export const KeyboardIcon = softIcon(Keyboard);
export const LaptopIcon = softIcon(Laptop);
export const LassoSelectIcon = softIcon(LassoSelect);
export const LayersIcon = softIcon(Layers);
export const LightningBoltIcon = softIcon(Zap);
export const Link1Icon = softIcon(Link);
export const Link2Icon = Link1Icon;
export const ListBulletIcon = softIcon(ListChecks);
export const LockClosedIcon = softIcon(LockKeyhole);
export const LoopIcon = softIcon(RefreshCw);
export const MagicWandIcon = softIcon(WandSparkles);
export const MenuIcon = softIcon(Menu);
export const MinusIcon = softIcon(Minus);
export const MixIcon = softIcon(Blend);
export const MobileIcon = softIcon(Smartphone);
export const MoonIcon = softIcon(Moon);
export const MoveIcon = softIcon(Move);
export const NotesIcon = softIcon(NotebookPen);
export const OptionsIcon = softIcon(SlidersHorizontal);
export const PanelLeftCloseIcon = softIcon(PanelLeftClose);
export const PanelLeftOpenIcon = softIcon(PanelLeftOpen);
export const PaperPlaneIcon = softIcon(Send);
export const PenIcon = softIcon(Pen);
export const Pencil1Icon = softIcon(PencilLine);
export const Pencil2Icon = softIcon(Pencil);
export const PersonIcon = AvatarIcon;
export const PieChartIcon = softIcon(ChartPie);
export const PinIcon = softIcon(Pin);
export const PlannerIcon = softIcon(Network);
export const PlusIcon = softIcon(Plus);
export const ReaderIcon = softIcon(BookOpen);
export const RedoIcon = softIcon(Redo2);
export const ResetIcon = softIcon(Undo2);
export const ResizeIcon = softIcon(ArrowDownRight);
export const RobotIcon = softIcon(Bot);
export const RocketIcon = softIcon(Rocket);
export const RowsIcon = softIcon(List);
export const RulerHorizontalIcon = softIcon(Ruler);
export const RulerSquareIcon = RulerHorizontalIcon;
export const ScissorsIcon = softIcon(Scissors);
export const SearchIcon = softIcon(Search);
export const SewingPinIcon = softIcon(MapPin);
export const Share1Icon = softIcon(Share2);
export const Share2Icon = Share1Icon;
export const ShieldIcon = softIcon(Shield);
export const SpeakerLoudIcon = softIcon(Volume2);
export const StackIcon = LayersIcon;
export const StarIcon = softIcon(Star);
export const StopwatchIcon = CountdownTimerIcon;
export const SunIcon = softIcon(Sun);
export const TableIcon = softIcon(Table);
export const TargetIcon = softIcon(Target);
export const TextIcon = softIcon(Type);
export const TimerIcon = CountdownTimerIcon;
export const TokensIcon = Component2Icon;
export const TrashIcon = softIcon(Trash2);
export const UploadIcon = softIcon(Upload);
export const VideoIcon = softIcon(Video);
export const ViewVerticalIcon = softIcon(Columns3);

/** Only named imports are used: the full Lucide catalog is never bundled. */
export const softProjectIcons = {
  AccessibilityIcon, ActivityLogIcon, ArchiveIcon, AvatarIcon, BackpackIcon, BadgeIcon, BarChartIcon,
  BookmarkIcon, BoxIcon, CalendarIcon, CameraIcon, ChatBubbleIcon, CheckCircledIcon, ClockIcon,
  CloudIcon, CodeIcon, CompassIcon, Component1Icon, Component2Icon, CubeIcon, DashboardIcon, DesktopIcon,
  DimensionsIcon, EnvelopeClosedIcon, FaceIcon, FileIcon, FileTextIcon, GearIcon, GlobeIcon,
  GridIcon, HandIcon, HeadphonesIcon, HeartIcon, HomeIcon, IdCardIcon, ImageIcon, KeyboardIcon,
  LaptopIcon, LayersIcon, LightningBoltIcon, Link1Icon, Link2Icon, ListBulletIcon, LockClosedIcon,
  LoopIcon, MagicWandIcon, MixIcon, MobileIcon, MoonIcon, PaperPlaneIcon, Pencil1Icon, Pencil2Icon,
  PersonIcon, PieChartIcon, ReaderIcon, RocketIcon, RulerHorizontalIcon, RulerSquareIcon,
  ScissorsIcon, SewingPinIcon, Share1Icon, Share2Icon, ShieldIcon, SpeakerLoudIcon, StackIcon,
  StarIcon, StopwatchIcon, SunIcon, TableIcon, TargetIcon, TimerIcon, TokensIcon, VideoIcon,
};
