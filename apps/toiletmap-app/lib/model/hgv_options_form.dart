import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'hgv_options.dart';

class HgvOptionsForm extends StatefulWidget {
  final HgvOptions options;
  final ValueChanged<HgvOptions> onChanged;

  const HgvOptionsForm({
    super.key,
    required this.options,
    required this.onChanged,
  });

  @override
  State<HgvOptionsForm> createState() => _HgvOptionsFormState();
}

class _HgvOptionsFormState extends State<HgvOptionsForm> {
  late TextEditingController _weightCtrl;
  late TextEditingController _axleCtrl;
  late TextEditingController _heightCtrl;
  late TextEditingController _widthCtrl;
  late TextEditingController _lengthCtrl;

  @override
  void initState() {
    super.initState();
    final o = widget.options;
    _weightCtrl = TextEditingController(text: o.weight?.toString() ?? '');
    _axleCtrl   = TextEditingController(text: o.axleLoad?.toString() ?? '');
    _heightCtrl = TextEditingController(text: o.height?.toString() ?? '');
    _widthCtrl  = TextEditingController(text: o.width?.toString() ?? '');
    _lengthCtrl = TextEditingController(text: o.length?.toString() ?? '');
  }

  @override
  void dispose() {
    _weightCtrl.dispose();
    _axleCtrl.dispose();
    _heightCtrl.dispose();
    _widthCtrl.dispose();
    _lengthCtrl.dispose();
    super.dispose();
  }

  HgvOptions _current() => HgvOptions(
        weight: double.tryParse(_weightCtrl.text),
        axleLoad: double.tryParse(_axleCtrl.text),
        height: double.tryParse(_heightCtrl.text),
        width: double.tryParse(_widthCtrl.text),
        length: double.tryParse(_lengthCtrl.text),
        hazardousMaterials: widget.options.hazardousMaterials,
        goodsDelivery: widget.options.goodsDelivery,
      );

  void _notify() => widget.onChanged(_current());

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Weight row
        Row(
          children: [
            Expanded(
              child: _NumField(
                controller: _weightCtrl,
                label: 'Gross Weight (t)',
                hint: 'e.g. 40.0',
                icon: Icons.scale,
                onChanged: (_) => _notify(),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _NumField(
                controller: _axleCtrl,
                label: 'Axle Load (t)',
                hint: 'e.g. 11.5',
                icon: Icons.commit,
                onChanged: (_) => _notify(),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),

        // Dimensions row
        Row(
          children: [
            Expanded(
              child: _NumField(
                controller: _heightCtrl,
                label: 'Height (m)',
                hint: '4.0',
                icon: Icons.height,
                onChanged: (_) => _notify(),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _NumField(
                controller: _widthCtrl,
                label: 'Width (m)',
                hint: '2.55',
                icon: Icons.swap_horiz,
                onChanged: (_) => _notify(),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _NumField(
                controller: _lengthCtrl,
                label: 'Length (m)',
                hint: '16.5',
                icon: Icons.straighten,
                onChanged: (_) => _notify(),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // Toggles
        _ToggleRow(
          icon: Icons.warning_amber_rounded,
          iconColor: const Color(0xFFFF0000),
          label: 'Hazardous Materials (HAZMAT)',
          value: widget.options.hazardousMaterials,
          onChanged: (v) => widget.onChanged(_current().copyWith(hazardousMaterials: v)),
        ),
        const SizedBox(height: 6),
        _ToggleRow(
          icon: Icons.inventory_2_outlined,
          iconColor: const Color(0xFF0000FF),
          label: 'Goods Delivery Vehicle',
          value: widget.options.goodsDelivery,
          onChanged: (v) => widget.onChanged(_current().copyWith(goodsDelivery: v)),
        ),

        const SizedBox(height: 12),
        // Preset buttons
        const Align(
          alignment: Alignment.centerLeft,
          child: Text(
            'PRESETS',
            style: TextStyle(
              color: Color(0xFF4A6A80),
              fontSize: 11,
              letterSpacing: 1.0,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            _PresetChip(
              label: 'Standard Artic',
              onTap: () => _applyPreset(weight: 44, axle: 11.5, h: 4.0, w: 2.55, l: 16.5),
            ),
            _PresetChip(
              label: 'Rigid 7.5t',
              onTap: () => _applyPreset(weight: 7.5, axle: 4.0, h: 3.5, w: 2.4, l: 8.0),
            ),
            _PresetChip(
              label: 'Low Bridge',
              onTap: () => _applyPreset(weight: 40, axle: 11.5, h: 3.0, w: 2.55, l: 16.5),
            ),
          ],
        ),
      ],
    );
  }

  void _applyPreset({
    required double weight,
    required double axle,
    required double h,
    required double w,
    required double l,
  }) {
    setState(() {
      _weightCtrl.text = weight.toString();
      _axleCtrl.text   = axle.toString();
      _heightCtrl.text = h.toString();
      _widthCtrl.text  = w.toString();
      _lengthCtrl.text = l.toString();
    });
    _notify();
  }
}

class _NumField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final ValueChanged<String> onChanged;

  const _NumField({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    const Color color = Color(0xFF0D2035);
    const Color hintColor = Color(0xFF0D2035);
    return TextField(
      controller: controller,
      onChanged: onChanged,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'[\d\.]')),
      ],
      style: const TextStyle(color: /*Color(0xFFE8F4FD)*/ color, fontSize: 13),
      
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        hintStyle: const TextStyle(color: /*Color(0xFF3A5570)*/hintColor, fontSize: 12),
        labelStyle: const TextStyle(color: /*Color(0xFF6A95B0)*/hintColor, fontSize: 12),
        prefixIcon: Icon(icon, color: /*const Color(0xFF4FC3F7)*/hintColor, size: 16),
        contentPadding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: /*Color(0xFF2E4A6A)*/color),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: /*Color(0xFF2E4A6A)*/color),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: /*Color(0xFF4FC3F7)*/hintColor),
        ),
        //filled: true,
        //fillColor: const Color(0xFFFFFFFF), //Color(0xFF0D1B2A),
      ),
      
    );
  }
}

class _ToggleRow extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _ToggleRow({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    const Color color = Color(0xFF0D2035);

    return Container(
      decoration: BoxDecoration(
        color: value ? iconColor.withValues(alpha: 0.08) : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: value ? iconColor.withValues(alpha: 0.4) : const Color(0xFF2E4A6A),
        ),
      ),
      child: SwitchListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 0),
        dense: true,
        secondary: Icon(icon, color: iconColor, size: 18),
        title: Text(
          label,
          style: TextStyle(
            color: value ? const Color(0xFFE8F4FD) : /*const Color(0xFF8BAFC8)*/color,
            fontSize: 13,
          ),
        ),
        value: value,
        onChanged: onChanged,
        activeThumbColor: iconColor,
      ),
    );
  }
}

class _PresetChip extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const _PresetChip({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      label: Text(label, style: const TextStyle(fontSize: 12, color: Color(0xFF0D2035))),
      onPressed: onTap,
      backgroundColor: Colors.transparent /* Color(0xFF0D2035)*/,
      side: const BorderSide(color: Color(0xFFFF0000)),
      padding: const EdgeInsets.symmetric(horizontal: 4),
    );
  }
}
