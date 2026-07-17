import { useState, useRef, useLayoutEffect as _useLayoutEffect, useEffect } from "react";
import { ChevronDown, ChevronRight, Code, BarChart3, Shield, Brain, Medal, GraduationCap, Building, Briefcase, Puzzle, Wifi } from "lucide-react";
import { InternalLink } from "@/components/InternalLink";
import {
  cardsGridColsClass,
  cardsPanelNominalWidthPx,
  resolveCardsLayout,
  type CardsLayoutConfig,
  CARDS_COLUMN_WIDTH_PX,
  CARDS_FIXED_WIDTH_PX,
} from "./cardsLayout";

// Falls back to useEffect during SSR to suppress the useLayoutEffect server warning
const useLayoutEffect = typeof window !== "undefined" ? _useLayoutEffect : useEffect;

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  code: Code,
  chart: BarChart3,
  shield: Shield,
  brain: Brain,
  medal: Medal,
  "graduation-cap": GraduationCap,
  building: Building,
  briefcase: Briefcase,
  puzzle: Puzzle,
  wifi: Wifi,
};

interface CardItem {
  title: string;
  description: string;
  cta: string;
  href: string;
  icon?: string;
}

interface ColumnItem {
  label: string;
  href: string;
}

interface Column {
  title: string;
  items: ColumnItem[];
}

interface GroupItem {
  label: string;
  href: string;
}

interface Group {
  title: string;
  items: GroupItem[];
}

interface CardsDropdownData {
  type: "cards";
  title?: string;
  description?: string;
  layout?: CardsLayoutConfig;
  items: CardItem[];
  footer?: {
    text: string;
  };
}

interface ColumnsDropdownData {
  type: "columns";
  title?: string;
  description?: string;
  icon?: string;
  columns: Column[];
}

interface SimpleListDropdownData {
  type: "simple-list";
  title?: string;
  description?: string;
  icon?: string;
  items: ColumnItem[];
}

interface GroupedListDropdownData {
  type: "grouped-list";
  title?: string;
  description?: string;
  icon?: string;
  groups: Group[];
}

type DropdownData = CardsDropdownData | ColumnsDropdownData | SimpleListDropdownData | GroupedListDropdownData;

export interface DropdownProps {
  label: string;
  href: string;
  dropdown: DropdownData;
}

function CardsDropdown({ dropdown, onNavigate }: { dropdown: CardsDropdownData; onNavigate?: () => void }) {
  const { mode, cols } = resolveCardsLayout(dropdown.items?.length ?? 0, dropdown.layout);
  const colsClass = cardsGridColsClass(cols);

  return (
    <div className="w-full min-w-0 p-6 bg-white dark:bg-zinc-900">
      {(dropdown.title || dropdown.description) && (
        <div className="mb-6 min-w-0">
          {dropdown.title && (
            <h3 className="text-lg font-semibold text-foreground mb-1">{dropdown.title}</h3>
          )}
          {dropdown.description && (
            <p className="text-sm text-muted-foreground">{dropdown.description}</p>
          )}
        </div>
      )}
      
      <div className={`grid gap-6 ${colsClass}`}>
        {dropdown.items.map((item, index) => {
          const IconComponent = item.icon ? iconMap[item.icon] : null;
          return (
            <InternalLink
              key={index}
              href={item.href}
              onNavigate={onNavigate}
              className="block min-w-0 hover-elevate rounded-lg p-2 -m-2"
              data-testid={`dropdown-card-${(item.title || "card").toLowerCase().replace(/\s+/g, "-")}`}
              style={mode === "max" ? { width: CARDS_COLUMN_WIDTH_PX } : undefined}
            >
              {IconComponent && (
                <div className="mb-3 w-12 h-12 flex items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <IconComponent className="w-6 h-6" />
                </div>
              )}
              <h4 className="text-base font-semibold text-foreground mb-2">
                {item.title}
              </h4>
              <p className="text-sm text-muted-foreground mb-3 line-clamp-4">
                {item.description}
              </p>
              <span className="inline-flex items-center text-sm font-medium border border-border rounded-md px-4 py-2 hover-elevate">
                {item.cta}
              </span>
            </InternalLink>
          );
        })}
      </div>
      
      {dropdown.footer?.text && (
        <div
          className="mt-6 pt-4 border-t text-center text-sm text-muted-foreground break-words [&_a]:text-primary [&_a]:no-underline [&_a:hover]:underline"
          dangerouslySetInnerHTML={{ __html: dropdown.footer.text }}
        />
      )}
    </div>
  );
}

function ColumnsDropdown({ dropdown, onNavigate }: { dropdown: ColumnsDropdownData; onNavigate?: () => void }) {
  const IconComponent = dropdown.icon ? iconMap[dropdown.icon] : null;
  
  return (
    <div className="w-full max-w-4xl p-6 bg-white dark:bg-zinc-900">
      {(dropdown.title || dropdown.description) && (
        <div className="flex items-start gap-4 mb-6 pb-4 border-b">
          {IconComponent && (
            <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-primary/10 text-primary flex-shrink-0">
              <IconComponent className="w-6 h-6" />
            </div>
          )}
          <div>
            {dropdown.title && (
              <span className="flex items-center gap-1 text-lg font-semibold text-foreground hover-elevate rounded-md">
                {dropdown.title}
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
            {dropdown.description && (
              <p className="text-sm text-muted-foreground mt-1">{dropdown.description}</p>
            )}
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
        {dropdown.columns.map((column, colIndex) => (
          <div key={colIndex}>
            <h4 className="text-base font-semibold text-foreground mb-3">{column.title}</h4>
            <ul className="space-y-2">
              {column.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <InternalLink
                    href={item.href}
                    onNavigate={onNavigate}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover-elevate rounded-md px-1 -mx-1"
                    data-testid={`dropdown-column-item-${(item.label || "item").toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {item.label}
                    <ChevronRight className="w-3 h-3" />
                  </InternalLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimpleListDropdown({ dropdown, onNavigate }: { dropdown: SimpleListDropdownData; onNavigate?: () => void }) {
  const IconComponent = dropdown.icon ? iconMap[dropdown.icon] : null;
  
  return (
    <div className="p-4 bg-white dark:bg-zinc-900">
      {(dropdown.title || dropdown.description) && (
        <div className="flex items-start gap-3 mb-4 pb-4 border-b">
          {IconComponent && (
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary/10 text-primary flex-shrink-0">
              <IconComponent className="w-5 h-5" />
            </div>
          )}
          <div>
            {dropdown.title && (
              <h3 className="text-base font-semibold text-foreground">{dropdown.title}</h3>
            )}
            {dropdown.description && (
              <p className="text-xs text-muted-foreground mt-1">{dropdown.description}</p>
            )}
          </div>
        </div>
      )}
      
      <ul className="space-y-1">
        {dropdown.items.map((item, index) => (
          <li key={index}>
            <InternalLink
              href={item.href}
              onNavigate={onNavigate}
              className="flex items-center justify-between px-2 py-2 rounded-md text-sm text-foreground hover-elevate"
              data-testid={`dropdown-list-item-${(item.label || "item").toLowerCase().replace(/\s+/g, "-")}`}
            >
              {item.label}
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </InternalLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroupedListDropdown({ dropdown, onNavigate }: { dropdown: GroupedListDropdownData; onNavigate?: () => void }) {
  const [activeGroup, setActiveGroup] = useState(0);
  const IconComponent = dropdown.icon ? iconMap[dropdown.icon] : null;
  
  return (
    <div className="w-full max-w-xl p-4 bg-white dark:bg-zinc-900">
      {(dropdown.title || dropdown.description) && (
        <div className="flex items-start gap-3 mb-4 pb-4 border-b">
          {IconComponent && (
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary/10 text-primary flex-shrink-0">
              <IconComponent className="w-5 h-5" />
            </div>
          )}
          <div>
            {dropdown.title && (
              <h3 className="text-base font-semibold text-foreground">{dropdown.title}</h3>
            )}
            {dropdown.description && (
              <p className="text-xs text-muted-foreground mt-1">{dropdown.description}</p>
            )}
          </div>
        </div>
      )}
      
      <div className="flex gap-6">
        <div className="w-32 flex-shrink-0 space-y-1">
          {dropdown.groups.map((group, index) => (
            <button
              key={index}
              onClick={() => setActiveGroup(index)}
              className={`w-full text-left px-3 py-2 text-xs font-semibold rounded-md transition-colors toggle-elevate ${
                activeGroup === index
                  ? "text-foreground bg-muted toggle-elevated"
                  : "text-muted-foreground"
              }`}
              data-testid={`dropdown-group-tab-${(group.title || "group").toLowerCase().replace(/\s+/g, "-")}`}
            >
              {group.title}
            </button>
          ))}
        </div>
        
        <div className="flex-1">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {dropdown.groups[activeGroup]?.items.map((item, index) => (
              <InternalLink
                key={index}
                href={item.href}
                onNavigate={onNavigate}
                className="flex items-center gap-1 py-1.5 text-sm text-muted-foreground hover-elevate rounded-md px-1 -mx-1"
                data-testid={`dropdown-group-item-${(item.label || "item").toLowerCase().replace(/\s+/g, "-")}`}
              >
                {item.label}
                <ChevronRight className="w-3 h-3" />
              </InternalLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const DROPDOWN_WIDTH_PX: Record<string, number> = {
  columns: 800,
  "simple-list": 288,
  "grouped-list": 550,
};

const VIEWPORT_PADDING = 16;

function getCardsLayoutFromDropdown(dropdown: DropdownData): CardsLayoutConfig | undefined {
  return dropdown.type === "cards" ? dropdown.layout : undefined;
}

function getCardsItemCount(dropdown: DropdownData): number {
  return dropdown.type === "cards" ? (dropdown.items?.length ?? 0) : 0;
}

export function Dropdown({ label, href, dropdown, controlledOpen, onOpenChange }: DropdownProps & { controlledOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = isControlled ? (v: boolean) => onOpenChange?.(v) : setInternalOpen;

  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isWideDropdown = dropdown.type === "cards" || dropdown.type === "columns";
  const cardsLayout =
    dropdown.type === "cards"
      ? resolveCardsLayout(getCardsItemCount(dropdown), getCardsLayoutFromDropdown(dropdown))
      : null;
  
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);
  
  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(true);
  };
  
  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 75);
  };
  
  const cardsNominalWidth =
    dropdown.type === "cards"
      ? cardsLayout?.mode === "max"
        ? cardsPanelNominalWidthPx(getCardsItemCount(dropdown), getCardsLayoutFromDropdown(dropdown))
        : CARDS_FIXED_WIDTH_PX
      : null;

  const getDropdownWidth = () => {
    switch (dropdown.type) {
      case "cards":
        // Width set via inline style from cardsNominalWidth so max mode hugs the card grid
        return cardsLayout?.mode === "max" ? "max-w-[calc(100vw-32px)]" : "w-[900px]";
      case "columns":
        return "w-[800px]";
      case "simple-list":
        return "w-72";
      case "grouped-list":
        return "w-[550px]";
      default:
        return "";
    }
  };

  const positionPanel = () => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const triggerRect = trigger.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const maxAvailable = viewportW - VIEWPORT_PADDING * 2;

    const nominalW =
      dropdown.type === "cards"
        ? (cardsNominalWidth ?? CARDS_FIXED_WIDTH_PX)
        : DROPDOWN_WIDTH_PX[dropdown.type] || panel.offsetWidth;

    const dropdownW = Math.min(nominalW, maxAvailable);

    if (dropdownW < nominalW) {
      panel.style.maxWidth = `${maxAvailable}px`;
    } else {
      panel.style.maxWidth = "";
    }

    if (dropdown.type === "cards" && cardsLayout?.mode === "max") {
      panel.style.width = `${dropdownW}px`;
    } else {
      panel.style.width = "";
    }

    const triggerCenter = triggerRect.left + triggerRect.width / 2;
    let idealLeft = isWideDropdown
      ? (viewportW - dropdownW) / 2
      : triggerCenter - dropdownW / 2;
    idealLeft = Math.max(VIEWPORT_PADDING, Math.min(idealLeft, viewportW - dropdownW - VIEWPORT_PADDING));

    const relativeLeft = idealLeft - triggerRect.left;
    panel.style.left = `${relativeLeft}px`;
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    positionPanel();

    window.addEventListener("resize", positionPanel);
    return () => window.removeEventListener("resize", positionPanel);
  }, [isOpen, cardsLayout?.mode, cardsLayout?.cols]);
  
  const closeOnNavigate = () => {
    setIsOpen(false);
  };

  const renderDropdownContent = () => {
    switch (dropdown.type) {
      case "cards":
        return <CardsDropdown dropdown={dropdown} onNavigate={closeOnNavigate} />;
      case "columns":
        return <ColumnsDropdown dropdown={dropdown} onNavigate={closeOnNavigate} />;
      case "simple-list":
        return <SimpleListDropdown dropdown={dropdown} onNavigate={closeOnNavigate} />;
      case "grouped-list":
        return <GroupedListDropdown dropdown={dropdown} onNavigate={closeOnNavigate} />;
      default:
        return null;
    }
  };
  
  return (
    <div
      ref={triggerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className="flex items-center gap-1 px-2 py-2 lg:px-4 font-medium text-foreground hover-elevate rounded-md transition-all duration-150 ease-out no-default-hover-elevate no-default-active-elevate"
        data-testid={`nav-dropdown-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {label}
        <ChevronDown className={`h-[1em] w-[1em] shrink-0 transition-transform duration-150 ease-out ${isOpen ? "rotate-180" : ""}`} />
      </button>
      
      {isOpen && (
        <>
          <div
            className="absolute left-0 right-0 top-full z-50"
            style={{ height: "1rem" }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
          <div
            ref={panelRef}
            className={`absolute top-full z-50 mt-1 bg-white dark:bg-zinc-900 border border-border rounded-lg shadow-lg ${getDropdownWidth()}`}
            style={{
              left: 0,
              ...(dropdown.type === "cards" && cardsLayout?.mode === "max" && cardsNominalWidth != null
                ? { width: cardsNominalWidth }
                : {}),
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {renderDropdownContent()}
          </div>
        </>
      )}
    </div>
  );
}
