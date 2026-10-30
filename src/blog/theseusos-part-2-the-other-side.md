---
title: "TheseusOS, part 2: the other side of the handoff"
description: The kernel wakes up holding a pointer to a structure it has never seen, in a machine that has just stopped helping it. Here's what it does first.
date: 2026-10-30
tags:
  - posts
  - theseusos
  - osdev
---
[Last time](/blog/theseusos-part-1-before-the-kernel/) we packed everything the kernel would need into a single structure, called [`ExitBootServices`](https://en.wikipedia.org/wiki/UEFI), and jumped. This post picks up on the other side of that jump.

The setup is worth restating, because it shapes everything that follows. The kernel starts with no memory allocator, no page tables of its own, no interrupt handlers, and no working assumption about where it is in memory. What it has is one argument: the physical address of the handoff structure. Firmware is not coming back.

## First: something to say

Before the kernel can do anything useful, it needs to be able to tell you what it's doing — because if the next thirty steps go wrong, the only evidence will be whatever got printed before the failure.

So the very first line of `kernel_entry` initialises logging. That ordering is deliberate and load-bearing: everything after it is allowed to log, so nothing before it may try.

Logging here can't use the [heap](https://en.wikipedia.org/wiki/Memory_management_(operating_systems)), because there isn't one yet. Messages go out over the serial port using fixed-size buffers, which is why the kernel log is a stream of small sequential lines rather than anything lively. It's not pretty, but it survives a machine that is still figuring out how to be a machine.

## Validating the handoff

Next the kernel takes that pointer and checks what it's been handed. This isn't ceremony. The handoff came from code that ran in a completely different environment, and the kernel has no way of knowing it's sane except by inspecting it.

The checks are unglamorous but specific:

- Does the `size` field match the size the kernel actually expects for this structure? A mismatch means the two halves disagree about the layout, and misreading the rest would be worse than stopping here.
- Is the format version non-zero?
- Is the CPU count at least one?
- If a framebuffer is present, does it have a size, non-zero dimensions, and a stride at least as wide as the image?
- If a memory map is present, do the entry count, descriptor size, and total size agree with each other?

Any failure is fatal. The kernel prints what went wrong, dumps registers and a short backtrace where it can, and stops. Given the alternative is dereferencing garbage and faulting somewhere confusing a hundred instructions later, failing loudly right here is a kindness.

One detail worth pointing out, because it's easy to miss: the kernel keeps using the handoff through its **physical** address, not a virtual one, for a while yet. There's no self-consistent virtual mapping to trust at this point, so the physical pointer stays authoritative until paging settles. Reading the structure through an address you've half-set-up is exactly how you get bugs that only appear after a refactor.

## Taking over the machine

Now the real work. UEFI left the CPU running with firmware's page tables, firmware's descriptor tables, and firmware's idea of how memory is arranged. The kernel has to replace all of it, in an order where each step leaves the machine functional enough for the next.

**Interrupts off.** Faults are going to happen. Until there are handlers installed that can deal with them, the safest thing is for the CPU not to accept any asynchronous interrupts at all.

**A new [GDT](https://en.wikipedia.org/wiki/Global_Descriptor_Table) and a [TSS](https://en.wikipedia.org/wiki/Task_state_segment).** Even in 64-bit mode, x86 still consults the GDT for privilege levels and the TSS for stack switching. The kernel installs its own — and, importantly, gives the TSS a set of [Interrupt Stack Table](https://wiki.osdev.org/Interrupt_Stack_Table) stacks. Those are dedicated stacks the CPU switches to automatically for specific faults, and they exist so that a [double fault](https://en.wikipedia.org/wiki/Double_fault) — which by definition means the normal stack is broken — still has somewhere to run a handler. There are separate ones for double faults, [NMI](https://en.wikipedia.org/wiki/Non-maskable_interrupt), [machine check](https://en.wikipedia.org/wiki/Machine-check_exception), and page faults, 16 KiB each.

**Control registers.** A modest amount of CR0/CR4 setup happens here, before paging changes: things the CPU needs set so that floating point, SSE state, and [page](https://en.wikipedia.org/wiki/Memory_paging) mechanics behave predictably once we switch.

**New page tables.** This is the big one, and the next section goes through it properly.

**The [CR3](https://en.wikipedia.org/wiki/Control_register#CR3) switch.** Load the new page-table root. From this instruction onward, the address space is the kernel's, not firmware's.

**A first [IDT](https://en.wikipedia.org/wiki/Interrupt_descriptor_table).** Installed early, so that while the kernel is still jumping between halves and switching stacks, a fault has somewhere to land instead of triple-faulting the machine into a reset.

## Building an address space

The kernel is running from an address that firmware chose, with firmware's translation in place. It needs to end up running from an address *it* chose, with its own tables. Getting from one to the other is the trickiest part of the whole boot.

The kernel allocates a fresh top-level table (a PML4) and fills it with several different mappings, each solving a different problem:

**An identity map of low physical memory.** Virtual address equals physical address for the low region. This exists so that the code currently executing — still addressing itself at its old physical location — stays valid while everything else is being set up. It's a bridge, not a home.

**The kernel at its higher-half home.** The kernel's own code and data, mapped at the virtual base it intends to occupy from now on. This is where execution is headed.

**A linear window over physical memory.** A fixed offset such that virtual address = offset + physical address. With this, the kernel can touch *any* physical address at any time by doing simple addition — no per-access page-table walking, no dependence on the identity map. It becomes the kernel's standard way of reaching physical memory, including the memory map data the handoff points at.

**Device [MMIO](https://en.wikipedia.org/wiki/Memory-mapped_I/O) regions.** The [framebuffer](https://en.wikipedia.org/wiki/Framebuffer), the local [APIC](https://en.wikipedia.org/wiki/Advanced_Programmable_Interrupt_Controller), and the I/O APIC all live at physical addresses that don't correspond to RAM. They get explicit mappings with the right caching flags, because caching a device register is a genuine bug with confusing symptoms.

Once the tables are built, the kernel flips CR3 to the new root and marks the linear physical window as "active", so address-conversion helpers can start relying on it.

## The higher-half jump

With the new tables live, execution is still running at its old low address — that identity map is currently doing the work. Now it moves to where it actually wants to be.

Switching isn't a single instruction. The kernel calculates the target: take the runtime address of the entry function, subtract the kernel's physical base, add the intended virtual base. Before jumping, it verifies the destination and both stacks are actually mapped with the right permissions, because discovering a missing mapping after the jump means faulting into a handler that may itself be unreachable.

Then it loads a new stack pointer — a dedicated 64 KiB kernel stack in the higher half — and jumps. The return address is meaningless; the function never returns. This is the point where the bridge is burned: the kernel is running from an address of its own choosing, on a stack of its own making.

## Making it a real machine again

That jump lands in a function that does the second half of the takeover, in a careful order.

The IDT gets reinstalled so its entries point at high-half handler addresses rather than the low ones installed earlier. The TSS's IST stack pointers get refreshed for the same reason. Then CPU features are detected properly and CR4 is hardened — enabling SSE support bits and marking pages global so that future CR3 flips don't needlessly flush them.

Then comes the moment of proof. Rather than assume interrupts work, the kernel tests it: configure the local APIC timer, arm a one-shot, briefly enable interrupts, and spin until the tick counter increments — or give up and warn loudly if it doesn't. If the timer interrupt never arrives, something upstream is broken, and that's much better to learn here than to discover later when a driver silently never receives its events.

With interrupts demonstrably working, the allocators come online in two stages.

The **temporary heap** from the handoff gets mapped into the higher half and used to bootstrap the global allocator, so kernel code can finally use `Vec` and `String` for real.

Then a **permanent heap** is mapped at its own fixed address, and the allocator switches to it. The temporary heap is then unmapped — deliberately, on purpose, as a stale-pointer detector. If any code still held something it allocated in the temporary heap and tries to use it afterwards, it now faults immediately and obviously instead of quietly corrupting whatever ended up reusing that memory.

The **persistent physical frame allocator** is built from the firmware memory map meanwhile, but only after being told which frames were consumed during boot — the page tables themselves, the kernel stacks, the IST stacks. Every one of those has to be marked used or the allocator will happily hand out memory it is currently executing from. That particular bug is spectacular.

Finally the kernel calls `SetVirtualAddressMap` so UEFI's runtime services work through the kernel's own address space rather than the firmware's, and reads the hardware clock through them as a proof of life.

## What's left

Platform discovery comes next — ACPI tables to find the I/O APICs and confirm the CPU count — and then the kernel draws something on the framebuffer for the first time and starts the timer properly, calibrated against the [PIT](https://en.wikipedia.org/wiki/Programmable_interval_timer) so that ticks correspond to real time rather than a hopeful guess.

That's where this post ends: the machine now has its own address space, its own heaps, its own interrupt tables, and a working clock. It's not an operating system yet — there are no threads, no processes, and nothing in user mode — but it is finally a program that owns the computer instead of borrowing it.

Next time: the parts of the machine that were already there and just needed finding.

---

*TheseusOS is open source — you can follow along at <https://github.com/emilf/TheseusOS>.*
