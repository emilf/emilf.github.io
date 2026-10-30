---
title: "TheseusOS, part 1: before the kernel"
description: The first in a series on my hobby OS. This one covers the bootloader, from the firmware's first breath to the moment control leaves it behind.
date: 2026-09-11
tags:
  - posts
  - theseusos
  - osdev
---
This is the first post in a series about [TheseusOS](/projects/theseusos/), my hobby operating system for [x86-64](https://en.wikipedia.org/wiki/X86-64) written in Rust. I've been poking at OS development on and off since I was a teenager, and I'm writing the series assuming very little systems-level background. Partly because that's the explanation I would have wanted when I started, and partly because writing it down forces me to check that I actually understand it.

This post is about the **bootloader**: the code that runs after the machine wakes up and before any of the kernel exists. The next one picks up at the handoff.

## The chain from the power button

Your operating system isn't the first thing to run. Between the power button and the [kernel](https://en.wikipedia.org/wiki/Kernel_(operating_system)) sits [firmware](https://en.wikipedia.org/wiki/Firmware), software baked into the motherboard. On a modern PC that firmware implements [UEFI](https://en.wikipedia.org/wiki/UEFI), the Unified Extensible Firmware Interface. It brings the hardware up, finds something bootable, and runs it.

For a normal machine, the thing it runs is a [bootloader](https://en.wikipedia.org/wiki/Bootloader) such as [GRUB](https://en.wikipedia.org/wiki/GNU_GRUB), which then loads Linux or Windows. For TheseusOS I skipped the middleman: bootloader and kernel are built as one program that UEFI launches directly. I'll get to why, and the reason is less noble than it sounds.

UEFI gets a bad reputation, some of it deserved. Against the old way, though — a [512-byte boot sector](https://en.wikipedia.org/wiki/Boot_sector) dropped into 16-bit [real mode](https://en.wikipedia.org/wiki/Real_mode) with no memory management at all — it's a picnic. You start in a flat 64-bit environment with the machine already configured, and you ask questions through structured interfaces instead of probing hardware blind.

The one thing that genuinely hurts is display output. UEFI has no text mode, so there's no usable text on screen until you build your own font rendering and write characters to a [framebuffer](https://en.wikipedia.org/wiki/Framebuffer) yourself. Until that exists, a serial line is your only window into the machine.

## Why you leave the firmware behind

UEFI gives your boot program a set of helpers called **boot services**: read a file, allocate memory, enumerate devices, and so on. They're useful, and while they exist you'd be foolish not to lean on them.

So why does every OS eventually call `ExitBootServices` and throw them away?

Because useful isn't the same as *yours*. While boot services are live, the firmware owns the machine. It owns the [page tables](https://en.wikipedia.org/wiki/Page_table) that translate virtual addresses to physical ones, and you don't get to redesign them. It owns the [Global Descriptor Table](https://en.wikipedia.org/wiki/Global_Descriptor_Table) and the [interrupt](https://en.wikipedia.org/wiki/Interrupt) tables, and you can't install your own. It manages memory on its own terms and expects to be the only one doing so. Try bringing up your own [device drivers](https://en.wikipedia.org/wiki/Device_driver) and taking over interrupt handling while the firmware is still working underneath you, and the two of you will fight over the same hardware and the same data structures.

To run an operating system you need to own the address space, the descriptor tables, interrupt routing, and the devices themselves. That becomes possible the moment the firmware steps away. Exiting boot services is how you take the machine over: after the call there are no more helpers, and everything the kernel needs has to already be in hand.

A small set of **runtime services** survive the transition — reading the hardware clock, reading and writing UEFI variables — but they're limited, and reaching them after you've replaced the page tables is its own piece of work. That belongs to the next post.

## Reading the machine before the window closes

The whole pre-handoff job comes down to this: the firmware's description of the machine is readable for a short while, and then it isn't. So the bootloader reads everything it might need and writes it down.

In TheseusOS the bootloader begins at `efi_main`, the entry point UEFI calls. The first orders of business are an output path, so failures are visible, and a temporary allocator that forwards to UEFI so Rust code can use strings and vectors before a real allocator exists.

Then it goes shopping.

**Graphics.** Through UEFI's Graphics Output Protocol it asks for the screen resolution, the pixel format, and the address of the framebuffer — the block of memory that *is* the display. Write a colour to the right offset and a pixel appears. Without that address the kernel can't draw anything.

**The physical memory map.** The firmware hands over a list describing every region of the machine's [physical memory](https://en.wikipedia.org/wiki/Memory_map): which parts are usable RAM, which are reserved for hardware, which are off-limits. The kernel needs this to know where it may place anything, so the bootloader copies the whole list into memory it controls, where the kernel can still read it once firmware is gone.

**ACPI tables.** [ACPI](https://en.wikipedia.org/wiki/ACPI) describes the machine's layout in machine-readable form: how many CPUs, where the interrupt controllers live, and so on. The bootloader locates the root table and records its address.

**System information.** Firmware vendor, a boot timestamp, CPU feature flags, and the UEFI system table, which is the top-level structure of the firmware world.

**Hardware inventory.** UEFI exposes devices as handles. The bootloader walks them and sorts what it finds into a small inventory: this is a PCI device, this is USB, this is a serial port. It's the kernel's first look at the actual hardware.

Every one of those stages writes its results into the same place.

## Packing the handoff

All of it lands in a single structure with a fixed layout, called the **handoff**. It's a plain C-style struct: a known sequence of fields at known offsets, so the kernel can read it with no parsing and no discovery of its own. The bootloader is the only thing that ever fills it in, and it does so exactly once.

Before the jump, the bootloader finishes the paperwork. It works out where the kernel image sits in memory — physical base, size, and the virtual address the kernel intends to run at once it has built its own page tables. It reserves a small temporary heap, deliberately placed so it doesn't overlap the kernel image, to carry the kernel through its first moments. Then it copies the finished handoff into `LOADER_DATA`, a memory type that survives what's coming.

Then comes the point of no return. The bootloader calls `ExitBootServices`, marks the copied handoff as having passed that boundary, and jumps into the kernel entry point with a plain function call.

That jump is the handoff, so this post stops there.

## Why one binary

Most operating systems keep bootloader and kernel as two separate programs: a small loader reads a kernel image off disk, parses it, and jumps in. TheseusOS originally did exactly that.

I merged them because the AI helper that writes this project's code could not reliably get the kernel's [ELF](https://en.wikipedia.org/wiki/Executable_and_Linkable_Format) parsing right. Rather than keep fighting it, I removed the step. One binary, no image format to parse, no loader logic to get wrong.

The cost is on the debugging side. [GDB](https://en.wikipedia.org/wiki/GNU_Debugger) is built around ELF symbol tables, and loading symbols for a unified UEFI binary is a headache I'd rather not have. A separate kernel ELF would make source-level debugging far less painful, which is reason enough to split the two apart again later. For now the single binary stays.

## What the bootloader really is

Strip away the protocol calls and the memory juggling and one job is left: the machine can only describe itself for a little while, so read all of it, record it, and get out before the door shuts.

Next time: the other side. The kernel wakes up holding a pointer to a structure it has never seen, in a machine that has just stopped helping it.

---

*TheseusOS is open source — you can follow along at <https://github.com/emilf/TheseusOS>.*
