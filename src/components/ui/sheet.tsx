import * as React from 'react'
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Root ──────────────────────────────────────────────────────────────────── */
function Sheet({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root {...props} />
}

/* ── Portal ────────────────────────────────────────────────────────────────── */
function SheetPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal {...props} />
}

/* ── Backdrop ──────────────────────────────────────────────────────────────── */
function SheetBackdrop({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Backdrop>) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="sheet-backdrop"
      className={cn(
        'fixed inset-0 z-50 bg-black/40',
        'transition-opacity duration-300',
        'data-[starting-style]:opacity-0',
        'data-[ending-style]:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

/* ── Content (Popup) ───────────────────────────────────────────────────────── */
function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Popup>) {
  return (
    <DrawerPrimitive.Popup
      data-slot="sheet-content"
      className={cn(
        'fixed inset-y-0 right-0 z-50 w-[420px] max-w-[90vw]',
        'bg-white shadow-xl border-l border-slate-200',
        'flex flex-col overflow-y-auto',
        'transition-transform duration-300 ease-in-out',
        'data-[starting-style]:translate-x-full',
        'data-[ending-style]:translate-x-full',
        className,
      )}
      style={{ direction: 'rtl' }}
      {...props}
    >
      <DrawerPrimitive.Close
        className="absolute top-4 left-4 rounded-full p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        aria-label="סגור"
      >
        <X size={18} />
      </DrawerPrimitive.Close>
      {children}
    </DrawerPrimitive.Popup>
  )
}

/* ── Header ────────────────────────────────────────────────────────────────── */
function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('px-5 pt-5 pb-3 border-b border-slate-100', className)}
      {...props}
    />
  )
}

/* ── Title ─────────────────────────────────────────────────────────────────── */
function SheetTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-lg font-extrabold text-slate-900', className)}
      {...props}
    />
  )
}

/* ── Description ───────────────────────────────────────────────────────────── */
function SheetDescription({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-slate-400 mt-1', className)}
      {...props}
    />
  )
}

/* ── Close ─────────────────────────────────────────────────────────────────── */
function SheetClose({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close {...props} />
}

export {
  Sheet,
  SheetPortal,
  SheetBackdrop,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
}
