---
title: "TheseusOS, part 3: platform discovery"
description: Parsing ACPI tables, enumerating PCI over ECAM, and taking USB controllers back from firmware.
date: 2026-11-05
tags:
  - posts
  - theseusos
  - osdev
---
Part 2 ended with the kernel running on its own page tables with working interrupts and a calibrated timer. This part covers the code that finds out what hardware is present.

## ACPI tables

The bootloader records the physical address of the [RSDP](https://wiki.osdev.org/RSDP) in the handoff. With the linear physical window active, that address is readable through `PHYS_OFFSET + pa` without any additional mapping.

The tables form a linked structure. The RSDP gives the extended system description table, which lists the rest, and each table is found by walking from there. The kernel uses the `acpi` crate, which requires an implementation of its `AcpiHandler` trait — the interface the crate uses to turn a physical address into something readable. The implementation is in [`kernel/src/acpi/mod.rs`](https://github.com/emilf/TheseusOS/blob/main/kernel/src/acpi/mod.rs).

Two paths exist in `ensure_acpi_virtual_mapping`. When the linear window is active, it returns `phys_to_virt_pa(pa)` directly. Otherwise it builds a mapping at a fixed window base (`0xFFFF_FF80_0000_0000`), which accommodates the case where [ACPI](https://en.wikipedia.org/wiki/ACPI) parsing happens before the linear map is trusted. The fallback also maps the handoff memory map into the `PHYS_OFFSET` range, since the parser may need it at the same stage. Mappings are not torn down afterwards; they stay for the lifetime of the kernel.

Two tables are used directly.

The [FADT](https://wiki.osdev.org/FADT) reports, among other fields, whether the platform includes a legacy [8259 PIC](https://en.wikipedia.org/wiki/Intel_8259). The information is recorded but the PIC is not programmed.

The [MADT](https://wiki.osdev.org/MADT) is parsed in [`kernel/src/acpi/madt.rs`](https://github.com/emilf/TheseusOS/blob/main/kernel/src/acpi/madt.rs) into a `MadtInfo` struct holding the list of local APIC IDs, the local APIC physical address, the I/O APIC entries with their IDs, addresses and [GSI](https://wiki.osdev.org/IOAPIC#GSI) bases, and a flag for 8259 presence. The CPU list includes the boot processor and every application processor the firmware reports. Only the boot processor is started; AP startup via [INIT/SIPI](https://wiki.osdev.org/Symmetric_Multiprocessing) is not implemented.

The I/O APIC addresses matter beyond bookkeeping. The serial driver's redirection entry is programmed from the first [I/O APIC](https://en.wikipedia.org/wiki/Advanced_Programmable_Interrupt_Controller) entry, which is what makes COM1 deliver an interrupt on the correct vector.

## PCI over ECAM

Configuration space is accessed through [ECAM](https://wiki.osdev.org/PCI_Express#Enhanced_Configuration_Access_Mechanism) rather than the legacy `0xCF8`/`0xCFC` port pair. ECAM is the memory-mapped mechanism described by the [MCFG](https://wiki.osdev.org/MCFG) table: each function's configuration space occupies 4 KiB at a computable address inside a window the firmware describes.

`collect_pci_config_regions` reads the MCFG table manually, since the `acpi` crate does not surface it, and produces a list of `PciConfigRegion` values with segment, bus range, base address and the stride between buses.

[`pci::enumerate`](https://github.com/emilf/TheseusOS/blob/main/kernel/src/drivers/pci.rs) walks those regions. For each bus it reads function 0 of every device slot, checks the header type field, and if the function is a [bridge](https://en.wikipedia.org/wiki/PCI_bridge) (`header_type & 0x7F == 0x01`) continues into the secondary bus once the bridge registers have been read. Visited buses are tracked in a `BTreeSet` keyed by segment and bus number, because PCIe topologies contain loops and an unguarded recursive walk does not terminate.

Each `PciDeviceInfo` carries vendor and device IDs, class code, subclass and programming interface, the [BAR](https://wiki.osdev.org/PCI#Base_Address_Registers) list, [MSI](https://wiki.osdev.org/Message_Signaled_Interrupts) and MSI-X capability flags, and the interrupt line from configuration space. BAR sizes are determined by writing `0xFFFFFFFF` into the register, reading back the writable bits, and restoring the original value.

`classify_pci_device` maps the class code onto a `DeviceClass`: class `0x0C` subclass `0x03` is a USB controller, `0x01` is storage, `0x02` network, `0x03` display, `0x04` audio, and `0x06` bridge handling varies by subclass. Anything unrecognised becomes `DeviceClass::Unknown`. Driver probing is filtered by this classification.

## USB legacy handoff

Firmware typically leaves USB controllers after the handoff in whatever state it was using them in. The specification defines a handoff mechanism so the OS can take ownership, and it differs per controller generation.

For [xHCI](https://en.wikipedia.org/wiki/Extensible_Host_Controller_Interface) (`handoff_xhci` in [`kernel/src/drivers/usb/handoff.rs`](https://github.com/emilf/TheseusOS/blob/main/kernel/src/drivers/usb/handoff.rs)), the code walks the capability registers to the supported-protocol section and checks the BIOS/OS semaphore. If firmware owns the controller, the OS sets its own bit and polls until firmware clears its bit, with a bounded wait. [EHCI](https://en.wikipedia.org/wiki/Host_controller_interface_(USB,_Firewire)) does the same through its extended capability registers, taking ownership and clearing the port routing bits that assign ports to the companion controller.

A timeout is logged as a warning and boot continues. The controller is likely unusable in that case, and the failure surfaces later when a driver attempts to use it.

`ensure_legacy_usb_handoff` runs over the PCI scan results before `usb::init()` registers any USB driver. If a driver initialized first, it would write controller registers while firmware still owned them.

This was the hardest part of the platform bring-up to get working. Interrupt delivery from xHCI is where it repeatedly failed: agents working on the code kept reverting the interrupt-driven paths to polling when the interrupts did not arrive. Getting MSI/MSI-X working reliably — correct `IMAN.IE` write semantics, draining deferred work, and mapping the [HID](https://en.wikipedia.org/wiki/USB_human_interface_device_class) endpoint ID correctly under QEMU — took several rounds before the driver stopped needing to poll.

## Device registration and driver binding

Each PCI function becomes a `Device` with a `DeviceId::Pci { segment, bus, device, function }`, a class, the memory and I/O resources derived from its BARs, the first memory BAR base as `phys_addr`, and the interrupt line as `irq`. Firmware-inventoried devices that are not on a PCI bus are added with `DeviceId::Raw`.

`driver_manager().lock().add_device(device)` inserts the device and immediately calls `probe_pending_devices`, both in [`kernel/src/drivers/manager.rs`](https://github.com/emilf/TheseusOS/blob/main/kernel/src/drivers/manager.rs). That function iterates unbound devices, iterates registered drivers, checks `supported_classes`, then calls `probe` and on success `init`. The first driver whose probe returns `Ok` binds the device and the loop stops.

There is no priority ordering and no deferred probing. The manager lock is held throughout, so `probe` and `init` must not block. A driver that needs to wait for hardware has to arrange it elsewhere.

With multiple controllers of the same class, the driver must decide in its own `probe` which one it accepts; the framework does not distinguish between them.

The serial driver bypasses PCI enumeration. It is registered early because it is the output path for everything that follows, and its I/O APIC redirection entry is installed from the MADT data. The logging subsystem and the monitor both write through it.

## Firmware inventory

The bootloader's UEFI handle walk produces a device list that the kernel imports here, in [`kernel/src/drivers/system.rs`](https://github.com/emilf/TheseusOS/blob/main/kernel/src/drivers/system.rs). This is how hardware outside PCI configuration space — the serial port among them — appears alongside the enumerated devices. Whether this snapshot remains useful once drivers do their own discovery is unresolved; at present it costs little and covers devices the PCI scan cannot see.

## State after this stage

The kernel has a CPU list, I/O APIC addresses, a PCI topology with resources and capability flags, and a binding between devices and drivers. Serial is the only device actively driven. USB is claimed from firmware and the xHCI driver is registered, but a working keyboard depends on the controller and on the handoff having succeeded. Storage functions are classified with no driver behind them.

The next part covers the xHCI driver and the keyboard path in more detail, including the interrupt problems above.

---

*TheseusOS is open source — you can follow along at <https://github.com/emilf/TheseusOS>.*
