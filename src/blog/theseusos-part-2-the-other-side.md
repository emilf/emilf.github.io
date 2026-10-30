---
title: "TheseusOS, part 2: the other side of the handoff"
description: The kernel wakes up with a pointer to a structure it has never seen, in a machine that has stopped helping it. Here's what it does first.
date: 2026-10-30
tags:
  - posts
  - theseusos
  - osdev
---
[Last time](/blog/theseusos-part-1-before-the-kernel/) we packed everything the kernel would need into a single structure, called [`ExitBootServices`](https://en.wikipedia.org/wiki/UEFI), and jumped. This picks up on the other side.

The kernel starts with no memory allocator and no page tables of its own. No interrupt handlers either, and no reliable idea of where it sits in memory. What it has is one argument: the physical address of the handoff structure. Firmware is not coming back.

## First: something to say

If the next thirty steps go wrong, the only evidence will be whatever got printed before the failure. So the very first line of `kernel_entry` initialises logging.

Everything after that point is allowed to log; nothing before it may try. Logging can't use the [heap](https://en.wikipedia.org/wiki/Memory_management_(operating_systems)) here, because there isn't one yet.

By default the messages go to the QEMU debug port, which is a single `out` instruction per byte — no buffer to fill, no status register to poll, nothing to wait on. That's not portable: it does nothing on real hardware, which is why it's the default here. The config can route output to the serial port instead, and errors and warnings already go to both. It's ugly either way. It also works on a machine that is still figuring out how to be a machine.

## Validating the handoff

Then the kernel looks at what it's been handed. The handoff came from code running in a completely different environment, and the kernel has no way to know it's sane except by checking it.

The checks are unglamorous and specific. Does `size` match what the kernel expects for this structure? If not, the two halves disagree about the layout, and reading the rest would be worse than stopping. Is the format version non-zero? Is the CPU count at least one? If a framebuffer is present, does it have a size, non-zero dimensions, and a stride at least as wide as the image? If a memory map is present, do the entry count, descriptor size, and total size agree with each other?

Any failure is fatal. The kernel prints what went wrong, dumps what registers and backtrace it can, and stops. The alternative is dereferencing garbage and faulting somewhere confusing a hundred instructions later.

One detail that's easy to skip past: the kernel keeps reading the handoff through its **physical** address, not a virtual one, for a while yet. There's no self-consistent virtual mapping to trust at this point, so the physical pointer stays authoritative until paging settles. Reading it through a half-built mapping is how you get bugs that only show up after a refactor.

## Taking over the machine

UEFI left the CPU running on firmware's page tables, firmware's descriptor tables, and firmware's arrangement of memory. The kernel has to replace all of it, in an order where each step leaves the machine functional enough for the next one.

Interrupts go off first. Faults are going to happen, and until handlers exist that can survive them, the CPU shouldn't be accepting asynchronous interrupts at all.

Then a new [GDT](https://en.wikipedia.org/wiki/Global_Descriptor_Table) and [TSS](https://en.wikipedia.org/wiki/Task_state_segment). Even in 64-bit mode, x86 still consults the GDT for privilege levels and the TSS for stack switching. The kernel installs its own, and gives the TSS a set of [Interrupt Stack Table](https://wiki.osdev.org/Interrupt_Stack_Table) stacks — dedicated stacks the CPU switches to for particular faults. They exist so a [double fault](https://en.wikipedia.org/wiki/Double_fault), which by definition means the normal stack is broken, still has somewhere to run a handler. Four of them, 16 KiB each: double fault, [NMI](https://en.wikipedia.org/wiki/Non-maskable_interrupt), [machine check](https://en.wikipedia.org/wiki/Machine-check_exception), page fault.

Some CR0/CR4 setup comes next, before paging changes — the bits that make floating point, SSE state, and page mechanics behave predictably once we switch.

Then new page tables, which get their own section below.

Then the [CR3](https://en.wikipedia.org/wiki/Control_register#CR3) switch. From that instruction onward the address space belongs to the kernel, not firmware.

Then a first [IDT](https://en.wikipedia.org/wiki/Interrupt_descriptor_table), installed early. While the kernel is still jumping between halves and swapping stacks, a fault needs somewhere to land instead of triple-faulting the machine into a reset.

## Building an address space

The kernel is running from an address firmware chose, with firmware's translation in place, and needs to end up running from an address it chose, with its own tables. Getting from one to the other is the nasty part of boot.

It allocates a fresh top-level table — a PML4 — and fills it with several mappings, each solving a different problem.

An identity map of low physical memory, where virtual address equals physical. This keeps the currently executing code valid while everything else is being arranged, since that code still addresses itself at its old physical location. It's a bridge, not a home.

The kernel itself, mapped at the virtual base it intends to occupy from now on.

A linear window over physical memory: a fixed offset such that virtual address is offset plus physical address. With that in place the kernel can reach any physical address by adding, with no page-table walk and no dependence on the identity map. It becomes the standard way of getting at physical memory, including the memory map the handoff points to.

Device [MMIO](https://en.wikipedia.org/wiki/Memory-mapped_I/O) regions. The [framebuffer](https://en.wikipedia.org/wiki/Framebuffer), the local [APIC](https://en.wikipedia.org/wiki/Advanced_Programmable_Interrupt_Controller), and the I/O APIC all sit at physical addresses that aren't RAM. They get explicit mappings with the right caching flags, because caching a device register produces genuinely confusing symptoms.

With the tables built, the kernel loads CR3 with the new root and marks the physical window as active so address-conversion helpers can start relying on it.

## The higher-half jump

Execution is still at its old low address, with the identity map doing the work. Now it moves.

The target is calculated by taking the runtime address of the entry function, subtracting the kernel's physical base, and adding the intended virtual base. Before jumping, the kernel checks that the destination and both stacks are mapped with the right permissions. Finding a missing mapping after the jump means faulting into a handler that may itself be unreachable.

Then it loads a new stack pointer — a dedicated 64 KiB kernel stack in the higher half — and jumps. The return address is meaningless because nothing returns. The bridge is burned at this point: the kernel is running from an address of its own choosing on a stack of its own making.

## Making it a real machine again

That jump lands in the function that finishes the takeover.

The IDT gets reinstalled so its entries point at high-half handler addresses instead of the low ones from earlier, and the TSS IST pointers get refreshed for the same reason. CPU features are detected properly and CR4 is hardened, enabling SSE support bits and marking pages global so future CR3 flips don't flush them needlessly.

Then the kernel checks whether interrupts actually work rather than assuming. It configures the local APIC timer, arms a one-shot, enables interrupts briefly and spins on the tick counter, giving up loudly if it never moves. If the timer interrupt doesn't arrive, something upstream is broken, and finding that out now beats discovering it later when a driver never receives its events.

The allocators come up in two stages.

The temporary heap from the handoff gets mapped into the higher half and bootstraps the global allocator, so kernel code can finally use `Vec` and `String`.

A permanent heap is then mapped at its own fixed address and the allocator switches over. The temporary heap is unmapped afterwards, deliberately, as a stale-pointer detector: anything still holding an allocation from the old heap faults immediately instead of quietly corrupting whatever reuses that memory.

Meanwhile the persistent physical frame allocator gets built from the firmware memory map, but only after being told which frames boot consumed — the page tables, the kernel stack, the IST stacks. Every one of those has to be marked used, or the allocator will eventually hand out memory the kernel is executing from. That bug is memorable.

Last, the kernel calls `SetVirtualAddressMap` so UEFI runtime services work through the kernel's address space rather than firmware's, then reads the hardware clock through them as a proof of life.

## What's left

Platform discovery comes next: ACPI tables to find the I/O APICs and confirm the CPU count. Then the first framebuffer draw, and the timer started for real, calibrated against the [PIT](https://en.wikipedia.org/wiki/Programmable_interval_timer) so ticks mean something.

At this point the machine has its own address space, heaps, interrupt tables and a clock. It isn't an operating system yet — no threads, no processes, nothing in user mode — but it's a program that owns the computer instead of borrowing it.

Next time: the parts of the machine that were already there and just needed finding.

---

*TheseusOS is open source — you can follow along at <https://github.com/emilf/TheseusOS>.*
