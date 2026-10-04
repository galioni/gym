import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// A text field that edits a stored string. What the user types goes out through [onChanged] (the caller debounces the
/// save); a stored value that changes underneath (a sync, another day) is shown, but never while the user is typing in it.
class NotesField extends StatefulWidget {
  const NotesField({
    super.key,
    required this.value,
    required this.onChanged,
    this.hint,
    this.minLines = 3,
    this.maxLines = 6,
    this.label,
    this.keyboardType,
    this.errorText,
    this.inputFormatters,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final String? hint;
  final String? label;
  final int minLines;
  final int maxLines;
  final TextInputType? keyboardType;
  final String? errorText;
  final List<TextInputFormatter>? inputFormatters;

  @override
  State<NotesField> createState() => _NotesFieldState();
}

class _NotesFieldState extends State<NotesField> {
  late final TextEditingController _controller = TextEditingController(text: widget.value);
  final _focus = FocusNode();

  @override
  void didUpdateWidget(NotesField old) {
    super.didUpdateWidget(old);
    if (widget.value != _controller.text && !_focus.hasFocus) {
      _controller.text = widget.value;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TextField(
        controller: _controller,
        focusNode: _focus,
        minLines: widget.minLines,
        maxLines: widget.maxLines,
        keyboardType: widget.keyboardType ?? (widget.maxLines == 1 ? TextInputType.text : TextInputType.multiline),
        textCapitalization: TextCapitalization.sentences,
        inputFormatters: widget.inputFormatters,
        decoration: InputDecoration(
          hintText: widget.hint,
          labelText: widget.label,
          errorText: widget.errorText,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
        ),
        onChanged: widget.onChanged,
      );
}
