---
title: "TheseusOS, part 4: the xHCI driver"
description: Bringing up a USB 3 host controller from scratch — rings, slots, descriptors, and the interrupt problem that kept sending the code back to polling.
date: 2026-11-13
tags:
  - posts
  - theseusos
  - osdev
---
Part 3 ended with a PCI scan, a classified device list, and USB controllers claimed back from firmware. This part is about the driver that talks to one of them, and about why it took far longer than expected.

The driver lives in [`kernel/src/drivers/usb/xhci/`](https://github.com/emilf/TheseusOS/tree/main/kernel/src/drivers/usb/xhci), split across four files: `mod.rs` for the controller state machine, `rings.rs` for the ring abstractions, `trb.rs` for the raw request-block encodings, and `hid.rs` for the keyboard-specific parts. `mod.rs` is around 4,900 lines.

## What xHCI is

[USB](https://en.wikipedia.org/wiki/USB) is a host-controlled bus. Devices don't interrupt the machine on their own; the host controller polls them on a schedule the host sets up. Before USB 3 the controllers were [UHCI/OHCI/EHCI](https://en.wikipedia.org/wiki/Host_controller_interface_(USB,_Firewire)), each generation with its own register interface and its own idea of how transfers worked.

[Extensible Host Controller Interface](https://wiki.osdev.org/EXtensible_Host_Controller_Interface) (xHCI) replaced all of that from USB 3.0 onward. It's a single specification covering every speed, and it's what QEMU exposes for `qemu-xhci`. It's also considerably more complex than its predecessors, because it has to be.

The interface is a block of [memory-mapped](https://en.wikipedia.org/wiki/Memory-mapped_I/O) registers (`MMIO`) divided into four regions:

- **Capability registers** — read-only, describe what the controller can do.
- **Operational registers** — command and status, port states, the run/stop bit.
- **Runtime registers** — the interrupter array, where event ring pointers and interrupt enable live.
- **Doorbell array** — one register per slot, written to tell the controller new work is queued.

The driver maps that aperture once at probe time and keeps the pointer for the controller's lifetime.

![The xHCI MMIO register layout: capability, operational, runtime and doorbell regions](/assets/img/xhci-registers.svg)

## Rings, and why everything is a ring

xHCI moves work through three kinds of [transfer request block](https://wiki.osdev.org/EXtensible_Host_Controller_Interface#TRBs) (TRB) ring.

The **command ring** carries instructions to the controller itself: enable a slot, address a device, configure an endpoint. The **event ring** carries completions and notifications back. Each device also gets one or more **transfer rings** — one per endpoint — carrying actual data.

All three are [DMA](https://en.wikipedia.org/wiki/Direct_memory_access) structures. The controller reads and writes them directly, so they must be physically contiguous, correctly aligned, and stay allocated for as long as the controller might touch them. [`rings.rs`](https://github.com/emilf/TheseusOS/blob/main/kernel/src/drivers/usb/xhci/rings.rs) wraps each kind in a struct holding the DMA buffer, a producer or consumer index, and a cycle bit.

The cycle bit is the part that catches people out. Every TRB carries a bit that flips when the ring wraps. A producer sets it to match the current cycle to say "this entry is valid"; a consumer compares against its own copy to decide whether an entry is new or stale. Get the bookkeeping wrong and the controller either processes stale entries or stops on one that never gets consumed, usually with no error reported anywhere.

![A TRB ring across two passes, showing how the cycle bit separates new entries from stale ones](/assets/img/xhci-ring-cycle.svg)

The event ring is the exception to the wrapping rule: it's a circular array of TRB *segments* rather than a single ring, with an entry table describing where each segment starts. The controller posts events into it and the driver advances the [Event Ring Dequeue Pointer](https://wiki.osdev.org/EXtensible_Host_Controller_Interface#Event_Ring) (ERDP) past each one as it consumes it.

## The bring-up sequence

Controller initialisation in `initialise_controller` follows the sequence the specification lays out, and the order matters.

Read `CAPLENGTH` to find where the operational registers begin, and `RTSOFF` and `DBCS` for the runtime and doorbell bases. Those offsets aren't fixed; taking them from the capability registers is what lets the same code work across implementations.

Then reset. The halt bit in the command register is cleared, the reset bit set, and the driver polls until the controller clears both and reports it's ready.

Next comes memory. The controller needs several structures alive before it will do anything useful: a [Device Context Base Address Array](https://wiki.osdev.org/EXtensible_Host_Controller_Interface#Device_Context_Base_Address_Array) (DCBAA) indexed by slot, the command and event rings, and — if the controller advertises them — scratchpad buffers. The scratchpad count comes from a split bitfield in `HCSPARAMS2`, five bits in one location and five in another, which is easy to read wrong and produces a controller that fails to start with no useful diagnostic.

With the structures staged, `CONFIG` gets the maximum number of slots and the run bit goes up. The driver waits for the halted bit to clear before doing anything else.

## Finding a device

A controller with no attached device still initialises. Device enumeration happens after, driven by port status.

Each port has a `PORTSC` register reporting connection status, link state, speed, and a set of change bits. The change bits are write-one-to-clear, which means reading the register and writing the value back with the bits set, without accidentally setting anything else. Bit 0 of `PORTSC` is connection status, bit 1 is port enabled, bit 4 is reset, and bits 17 through 23 are the change flags.

`reset_port` clears the change bits, sets the reset bit, and polls until it clears. After a reset the link is trained and the port reports the device's speed. Then the sequence is the normal USB one, but expressed as xHCI commands rather than register pokes:

**Enable Slot** allocates a slot ID. The controller returns it in the completion event.

**Address Device** takes a buffer describing the device's default control endpoint — endpoint 0, packet size from the speed, marked as a control endpoint — and gives the device its address.

**Get Descriptor** reads the device descriptor (18 bytes) to learn the vendor and product IDs and the maximum packet size. A second request reads the configuration descriptor, which is a variable-length structure listing interfaces and their endpoints.

**Set Configuration** selects a configuration value.

**Set Protocol** tells a [HID](https://en.wikipedia.org/wiki/USB_human_interface_device_class) interface to use the boot protocol, which guarantees an 8-byte report format instead of whatever the vendor designed.

**Configure Endpoint** sets up the interrupt endpoint: its type, the max packet size and interval from the descriptor, and the address of its transfer ring.

![The enumeration sequence: controller bring-up, then slot allocation through endpoint configuration](/assets/img/xhci-enumeration.svg)

The endpoint ID is derived from the endpoint address in the descriptor — address `0x81` is endpoint 1 in, and the driver maps that onto the controller's numbering. Getting this mapping wrong was one of the debugging detours mentioned below.

## Getting a keystroke

Once the interrupt endpoint is configured, the driver queues a transfer ring entry pointing at a report buffer and rings the doorbell. The controller polls the device at the interval in the descriptor and writes reports into that buffer.

A boot keyboard report is 8 bytes: a modifier bitmap, a reserved byte, and up to six usage codes for keys currently held. [Usage codes](https://wiki.osdev.org/USB_HID) are not ASCII. `0x04` through `0x1D` are A through Z, `0x1E` through `0x27` are the digit row, `0x28` is Enter, and so on.

[`hid.rs`](https://github.com/emilf/TheseusOS/blob/main/kernel/src/drivers/usb/xhci/hid.rs) diffs each report against the previous one. Any usage code in the new report but not the old one is a press; any in the old but not the new is a release. The same diff runs over the modifier bitmap. That's the whole decoder — it doesn't handle key repeat, doesn't do layouts, and doesn't attempt to be a real HID implementation.

Decoded events go to a shared hub in [`kernel/src/input/keyboard.rs`](https://github.com/emilf/TheseusOS/blob/main/kernel/src/input/keyboard.rs), which holds a bounded queue of 64 events and a small listener set. The monitor pops from that queue. Nothing goes anywhere near a terminal driver, because there isn't one.

## The interrupt problem

This is where the driver spent most of its life.

Polling works. You can run the event ring in a loop, drain completions, and everything functions — which is exactly why it kept happening. Interrupts are the correct design, and every time the interrupt path didn't work, the fastest way to make progress was to poll instead.

The chain that has to work is longer than it looks. The controller raises an interrupt through [MSI or MSI-X](https://wiki.osdev.org/Message_Signaled_Interrupts). The kernel has to have configured the corresponding PCI capability, pointed it at a vector, and installed a handler for that vector. The controller has to have the interrupter enabled. And the event ring has to be drained properly when the handler runs.

Several things went wrong in sequence:

**`IMAN.IE` write semantics.** The Interrupter Management register has an enable bit and a pending bit. The pending bit is write-one-to-clear, so writing back a value read from the register will acknowledge — and potentially clear — a pending interrupt you meant to service. Enabling the interrupter has to be a read-modify-write that sets only `IE` and deliberately leaves `IP` alone. Getting this wrong gives you an interrupt that either never fires or fires once.

**MSI-X function mask.** Masked by default in some configurations, and a masked function silently swallows messages. The driver has to clear the mask bit in the vector control register, not just program the address.

**Endpoint ID mapping.** For a while the interrupt endpoint was being configured with an ID that didn't match what the controller associated with the device, which meant completions landed on a ring nobody was servicing.

**Deferred servicing under a lock.** The handler runs in interrupt context and can't take the controller list lock, because another context — the monitor querying diagnostics, for instance — may already hold it. So the handler sets a latch and returns, and thread context drains the ring later via `service_deferred_runtime`. Without that, the lock contention produces a deadlock that looks like the keyboard freezing.

The driver now has both paths, and prefers interrupts. `poll_runtime_events_fallback` only services controllers that didn't get MSI working.

There's a diagnostic worth mentioning because it's how the problem was eventually pinned down. `kick_msix_self_test` submits a no-op command after interrupts are enabled and waits to see whether the completion arrives through the interrupt path or only through polling. When it only arrives through polling, the controller is running but the interrupt configuration is wrong — which narrows the fault to the MSI setup rather than anything downstream.

## State of play

The driver enumerates devices, configures a HID keyboard, decodes reports into key events, and services the event ring on interrupt. It works under QEMU. It has not been tested against real xHCI hardware, and there are areas it doesn't touch: no hub support, no isochronous transfers, no USB 2 companion controller handling beyond the legacy handoff, and no removal handling after the fact.

The single-endpoint limit shows in the structure. One controller tracks one attached port, one active slot, and one HID endpoint. A second device on the same controller isn't going to be found.

The next part goes after storage, which means [AHCI](https://en.wikipedia.org/wiki/Advanced_Host_Controller_Interface) and the block layer underneath a filesystem. That's less finicky than USB interrupt plumbing and more revealing, because it's the first place where data has to survive a round trip.

---

*TheseusOS is open source — you can follow along at <https://github.com/emilf/TheseusOS>.*
