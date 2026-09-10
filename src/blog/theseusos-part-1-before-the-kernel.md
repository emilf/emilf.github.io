---
title: "TheseusOS, part 1: before the kernel"
description: The first in a series on my hobby OS. This one is about the bootloader — what happens after you press the power button, before a single line of kernel code runs.
date: 2026-09-11
tags:
  - posts
  - theseusos
  - osdev
---
This is the first post in a series about [TheseusOS](/projects/theseusos/), my hobby operating system for x86_64 written in Rust. I want to write the series assuming very little systems-level knowledge — partly because that's the kind of explanation I wish I'd had when I started, and partly because writing it down forces me to be honest about what I actually understand.

This post covers the *bootloader*: the code that runs when you press the power button, before any of the kernel exists. The next post will pick up at the handoff — the moment control leaves the firmware behind and the kernel takes over.

## What actually happens when you press power?

Here's the thing that surprised me when I first went down this path: your operating system is not the first thing that runs. Not even close.

Between the power button and your kernel, there's a whole layer of software called **firmware**. On modern PCs, that firmware implements something called **UEFI** — the Unified Extensible Firmware Interface. UEFI is the modern replacement for the old-school BIOS, and its job is to wake up the hardware, find something bootable, and then run it.

For a normal computer, "something bootable" is a bootloader like GRUB, which then loads Linux or Windows. For TheseusOS, I skipped the middleman: our "bootloader" and our "kernel" are compiled into a **single program** that UEFI runs directly. That decision matters a lot, and I'll come back to it.

One more piece of vocabulary before we go further:

- **Kernel** — the core of an operating system. It manages memory, talks to hardware, and decides what runs when.
- **Bootloader** — the program that prepares the machine so the kernel *can* run.
- **Firmware / UEFI** — the software baked into the motherboard that runs before anything else.

Now, the bootloader's job sounds simple: "set things up for the kernel." The catch is *what* it has to set up, and why it has to do some of it at a very specific moment.

## The window that closes

UEFI gives your boot program a set of services — helper functions for things like "read a file," "allocate some memory," "give me a map of the machine's RAM." These are called **boot services**, and they're enormously convenient. They're also temporary.

At some point, the bootloader has to call a function called `ExitBootServices`. After that call, *every single one of those helpers is gone.* The firmware steps back, and if you didn't save something you needed beforehand, you simply don't get it. There's no going back to ask for it later.

So the bootloader exists to answer one question within a shrinking window: **what does the kernel need to know about this machine, and how do I gather all of it before the door closes?**

Almost the entire pre-handoff story is that question being answered.

## Step one: a place to write things down

Before you can gather anything, you need to be able to *talk to the user* — because if something goes wrong in the dark, you want to see why.

TheseusOS's bootloader starts in a function called `efi_main` (that's the entry point UEFI calls). The very first order of business is setting up a **logging path** — a way to print text — and a tiny memory allocator so the Rust code can use things like strings and vectors before the "real" allocator exists.

Two details I like here, because they're honest about life in firmware-land:

- The output driver can route text to different places (the QEMU debug port, a UEFI serial console, and so on). During early boot, you'd rather have *some* way to see output than a pretty one.
- The allocator isn't the kernel's allocator. It's a temporary shim that forwards requests to UEFI's own memory functions. It'll be thrown away later. Grown-up allocation comes after boot services are gone.

The whole bootloader is, in a sense, a sequence of temporary things that exist to carry information across a one-way door.

## Step two: gather the facts

With logging working, the bootloader goes on a shopping trip. In order, it collects:

**1. Graphics.** It asks UEFI's Graphics Output Protocol (GOP) for the screen's resolution, pixel format, and — crucially — the address of the **framebuffer**: the block of memory that *is* the screen. Write a pixel's colour into the right spot in that block, and a pixel lights up. If the kernel wants to draw anything at all, it needs that address.

**2. The memory map.** This is the big one. The firmware hands over a list describing every region of the machine's RAM: which parts are usable, which are reserved for hardware, which are off-limits for other reasons. Without this map, the kernel has no idea where it's allowed to put anything. We copy the whole thing into memory we control so the kernel can read it later without needing UEFI.

**3. ACPI tables.** ACPI is the standard that describes the machine's hardware layout in a structured way — how many CPUs, where the interrupt controllers live, and so on. The bootloader finds the root table (the "RSDP") and records where it is, so the kernel can parse the details after firmware is gone.

**4. System information.** Firmware vendor, a boot timestamp, CPU feature flags, and the system table itself — the top-level structure of the whole UEFI world. Some of this is genuinely useful; some of it is just good to have for debugging.

**5. Hardware inventory.** This is a fun one. UEFI exposes devices as "handles," and the bootloader walks them, classifying what it finds into a small inventory — this is a PCI device, this is USB, this is a serial port. It's the kernel's first glimpse of the physical machine.

Each of these collections writes its results into a single shared structure in memory. That structure, called the **handoff**, is the whole point of the exercise. Think of it as a suitcase that the bootloader packs and the kernel unpacks, with no chance to send anything later.

## Step three: pack the suitcase properly

Having gathered the facts, the bootloader does some final bookkeeping before the door closes.

It works out where the kernel image itself lives in memory — the single binary that contains both the bootloader code and the kernel code. It computes the kernel's physical base address, its size, and the virtual address it wants to run at later. This matters because the kernel is going to build brand-new page tables (the maps that translate "virtual" addresses the code uses into "physical" addresses in the RAM chips), and it needs to know where it currently sits so it can map itself into its new home.

It also carves out a **temporary heap**: a scratch block of memory that the kernel will briefly use in its earliest moments, before it has set up memory management of its own. There's a subtle wrinkle here — this scratch block must not overlap the kernel image, so the bootloader asks UEFI for memory that specifically avoids that range. The comments in the code are refreshingly honest that this uses a conservative estimate rather than exact accounting; it's good enough to work, and documented as such.

Then it finalises the handoff: making sure the structure is complete and self-describing.

## The last thing before the jump

At this point the suitcase is packed. Everything the kernel will ever know about this machine is sitting in one structure in memory.

The bootloader now does the serious bit. It copies that structure into a special kind of memory (`LOADER_DATA`) that's guaranteed to survive what comes next, and then it calls `ExitBootServices`. Firmware steps back. Control transfers — via a plain function call, in the same binary — into the kernel's entry point.

And that's where this post stops, because that transfer *is* the handoff, and the handoff is the next post.

## Why a single binary, though?

I promised I'd come back to this. The conventional design is two programs: a bootloader that loads a *separate* kernel file from disk, parses it, and jumps into it. That's how most operating systems do it, and it's the right choice for a real OS.

TheseusOS deliberately isn't that. The bootloader and kernel are one program. There are real trade-offs here — you lose the clean separation, and the "kernel image accounting" gets a bit hand-wavy, as we saw above. But you gain something I care about a lot for a learning project: **you can step through the entire journey from firmware to kernel in one debugger session, with no mystery gap in the middle.** No image-format parsing between the two halves, no "how did we get here" when a debugger stops.

It's a simple choice that suits a project built mainly to understand how all this fits together. I'm not trying to build something clever, just something I can follow.

## What I took away from writing this

Reducing the bootloader to its essentials, it's really just this: *the machine's self-description is readable only for a little while, so read all of it, write it down, and leave before the door shuts.*

Everything else — the protocol calls, the memory juggling, the inventory — is in service of that one idea.

Next time: what happens on the other side. The kernel wakes up holding a pointer to a structure it's never seen before, in a machine that has just stopped helping it, and has to decide what to do first.

---

*TheseusOS is open source — you can follow along at <https://github.com/emilf/TheseusOS>.*
