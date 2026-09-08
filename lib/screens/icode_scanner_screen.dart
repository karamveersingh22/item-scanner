import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

import '../services/database_service.dart';

const _kOrange = Color(0xFFFF8C00);
const _kRed = Color(0xFFE53935);
const _kBg = Color(0xFF0D0D1A);
const _kCard = Color(0xFF14142B);

class ICodeScannerScreen extends StatefulWidget {
  const ICodeScannerScreen({super.key});
  @override
  State<ICodeScannerScreen> createState() => _ICodeScannerScreenState();
}

class _ICodeScannerScreenState extends State<ICodeScannerScreen>
    with TickerProviderStateMixin {
  final DatabaseService _databaseService = DatabaseService();

  CameraController? _cameraController;
  late final TextRecognizer _textRecognizer;

  bool _isCameraReady = false;
  bool _isProcessing = false;
  bool _foundCode = false;

  String? _scannedCode;
  Map<String, dynamic>? _scannedItem;
  bool _itemNotFound = false;

  DateTime _lastProcessedTime = DateTime.fromMillisecondsSinceEpoch(0);
  String _status = 'Starting camera...';

  // Animations
  late AnimationController _scanLineCtrl;
  late AnimationController _slideCtrl;
  late Animation<double> _scanLineAnim;
  late Animation<Offset> _slideAnim;

  @override
  void initState() {
    super.initState();
    _textRecognizer = TextRecognizer(script: TextRecognitionScript.latin);

    _scanLineCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 2000))
      ..repeat(reverse: true);
    _scanLineAnim = Tween<double>(begin: 0.0, end: 1.0)
        .animate(CurvedAnimation(parent: _scanLineCtrl, curve: Curves.easeInOut));

    _slideCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 420));
    _slideAnim = Tween<Offset>(begin: const Offset(0, 1), end: Offset.zero)
        .animate(CurvedAnimation(parent: _slideCtrl, curve: Curves.easeOutCubic));

    _startCamera();
  }

  // ══ Business logic (unchanged) ═══════════════════════════════════

  Future<void> _startCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        if (!mounted) return;
        setState(() => _status = 'No camera found');
        return;
      }
      final camera = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      _cameraController = CameraController(camera, ResolutionPreset.medium, enableAudio: false, imageFormatGroup: ImageFormatGroup.nv21);
      await _cameraController!.initialize();
      if (!mounted) return;
      setState(() { _isCameraReady = true; _status = 'Point camera at I.CODE'; });
      await _cameraController!.startImageStream(_processCameraImage);
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'Camera error:\n$e');
    }
  }

  Future<void> _processCameraImage(CameraImage image) async {
    if (_isProcessing || _foundCode) return;
    final now = DateTime.now();
    if (now.difference(_lastProcessedTime) < const Duration(milliseconds: 350)) return;
    _lastProcessedTime = now;
    _isProcessing = true;
    try {
      final inputImage = _convertCameraImage(image);
      if (inputImage == null) return;
      final recognizedText = await _textRecognizer.processImage(inputImage);
      if (_foundCode || !mounted) return;
      final code = _extractICode(recognizedText.text);
      if (code != null) {
        _foundCode = true;
        setState(() => _status = 'I.CODE detected \u2713');
        try {
          if (_cameraController != null && _cameraController!.value.isStreamingImages) {
            await _cameraController!.stopImageStream();
          }
          if (_cameraController != null && !_cameraController!.value.isPreviewPaused) {
            await _cameraController!.pausePreview();
          }
        } catch (_) {}
        final item = await _databaseService.findItem(code);
        if (!mounted) return;
        setState(() { _scannedCode = code; _scannedItem = item; _itemNotFound = (item == null); });
        _slideCtrl.forward();
      }
    } catch (e) {
      debugPrint('OCR error: $e');
    } finally {
      _isProcessing = false;
    }
  }

  String? _extractICode(String text) {
    final normalized = text.replaceAll('\n', ' ');
    final pattern = RegExp(r'(?:I|1)\s*[._]?\s*CODE\s*[:\-]?\s*([0-9]{3,})', caseSensitive: false);
    final match = pattern.firstMatch(normalized);
    if (match != null) return match.group(1);
    return null;
  }

  InputImage? _convertCameraImage(CameraImage image) {
    final controller = _cameraController;
    if (controller == null || !controller.value.isInitialized) return null;
    final sensorOrientation = controller.description.sensorOrientation;
    final InputImageRotation rotation;
    if (sensorOrientation == 90) rotation = InputImageRotation.rotation90deg;
    else if (sensorOrientation == 270) rotation = InputImageRotation.rotation270deg;
    else if (sensorOrientation == 180) rotation = InputImageRotation.rotation180deg;
    else rotation = InputImageRotation.rotation0deg;
    if (!Platform.isAndroid) return null;
    if (image.planes.length != 1) return null;
    final plane = image.planes.first;
    return InputImage.fromBytes(
      bytes: plane.bytes,
      metadata: InputImageMetadata(size: Size(image.width.toDouble(), image.height.toDouble()), rotation: rotation, format: InputImageFormat.nv21, bytesPerRow: plane.bytesPerRow),
    );
  }

  Future<void> _restartScanner() async {
    if (!mounted) return;
    setState(() { _foundCode = false; _isProcessing = false; _lastProcessedTime = DateTime.fromMillisecondsSinceEpoch(0); _status = 'Point camera at I.CODE'; _scannedCode = null; _scannedItem = null; _itemNotFound = false; });
    _slideCtrl.reset();
    final controller = _cameraController;
    if (controller != null && controller.value.isInitialized) {
      try {
        if (controller.value.isPreviewPaused) await controller.resumePreview();
        if (!controller.value.isStreamingImages) await controller.startImageStream(_processCameraImage);
      } catch (e) { debugPrint('Could not restart camera stream: $e'); }
    }
  }

  Future<void> _closeScanner() async {
    try {
      final controller = _cameraController;
      if (controller != null && controller.value.isStreamingImages) await controller.stopImageStream();
    } catch (_) {}
    if (!mounted) return;
    Navigator.pop(context);
  }

  @override
  void dispose() {
    _cameraController?.dispose();
    _textRecognizer.close();
    _scanLineCtrl.dispose();
    _slideCtrl.dispose();
    super.dispose();
  }

  // ══ BUILD ════════════════════════════════════════════════════════

  @override
  Widget build(BuildContext context) {
    // Item found
    if (_scannedItem != null) return _buildItemFoundScreen();
    // Item not found
    if (_itemNotFound) return _buildItemNotFoundScreen();
    // Camera loading
    if (!_isCameraReady || _cameraController == null) return _buildCameraLoading();
    // Camera active
    return _buildCameraScreen();
  }

  // ── Camera loading ────────────────────────────────────────────

  Widget _buildCameraLoading() => Scaffold(
    backgroundColor: _kBg,
    appBar: AppBar(backgroundColor: _kCard, title: Text('Read I.CODE', style: GoogleFonts.outfit(fontWeight: FontWeight.w700))),
    body: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      Container(width: 72, height: 72, decoration: BoxDecoration(gradient: const LinearGradient(colors: [_kOrange, _kRed]), borderRadius: BorderRadius.circular(20)),
        child: const Icon(Icons.document_scanner_rounded, color: Colors.white, size: 38)),
      const SizedBox(height: 28),
      const SizedBox(width: 26, height: 26, child: CircularProgressIndicator(color: _kOrange, strokeWidth: 3)),
      const SizedBox(height: 18),
      Text(_status, textAlign: TextAlign.center, style: GoogleFonts.outfit(color: Colors.white54, fontSize: 15)),
    ])),
  );

  // ── Live camera screen ────────────────────────────────────────

  Widget _buildCameraScreen() {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(fit: StackFit.expand, children: [
        // Camera preview
        CameraPreview(_cameraController!),

        // Dark vignette overlay
        Container(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: Alignment.center, radius: 1.0,
              colors: [Colors.transparent, Colors.black.withOpacity(0.55)],
            ),
          ),
        ),

        // Top bar
        Positioned(top: 0, left: 0, right: 0,
          child: SafeArea(child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(children: [
              IconButton(
                icon: Container(padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: Colors.black.withOpacity(0.5), shape: BoxShape.circle),
                  child: const Icon(Icons.close_rounded, color: Colors.white, size: 22)),
                onPressed: _closeScanner,
              ),
              const Spacer(),
              Text('READ I.CODE', style: GoogleFonts.outfit(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 1.5)),
              const Spacer(),
              const SizedBox(width: 48),
            ]),
          )),
        ),

        // Scan frame with animated corners
        Center(child: _buildScanFrame()),

        // Instruction label above frame
        Positioned(
          top: MediaQuery.of(context).size.height * 0.5 - 120,
          left: 0, right: 0,
          child: Center(child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: BoxDecoration(color: Colors.black.withOpacity(0.6), borderRadius: BorderRadius.circular(20)),
            child: Text('Place I.CODE label inside the frame', style: GoogleFonts.outfit(color: Colors.white70, fontSize: 13)),
          )),
        ),

        // Status bar at bottom
        Positioned(bottom: 40, left: 24, right: 24,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.72),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: Colors.white.withOpacity(0.1)),
            ),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              if (!_foundCode) ...[
                const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: _kOrange)),
                const SizedBox(width: 12),
              ],
              Flexible(child: Text(_status, textAlign: TextAlign.center,
                style: GoogleFonts.outfit(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600))),
            ]),
          )),
      ]),
    );
  }

  Widget _buildScanFrame() {
    const frameW = 320.0;
    const frameH = 140.0;
    const corner = 22.0;
    const thick = 3.5;

    return SizedBox(width: frameW, height: frameH,
      child: Stack(children: [
        // Dim overlay outside (handled by vignette above; subtle frame darkening)
        // Corner brackets
        Positioned(top: 0, left: 0, child: _corner(corner, thick, topLeft: true)),
        Positioned(top: 0, right: 0, child: _corner(corner, thick, topRight: true)),
        Positioned(bottom: 0, left: 0, child: _corner(corner, thick, bottomLeft: true)),
        Positioned(bottom: 0, right: 0, child: _corner(corner, thick, bottomRight: true)),

        // Animated scan laser line
        AnimatedBuilder(
          animation: _scanLineAnim,
          builder: (_, __) {
            final y = _scanLineAnim.value * (frameH - 2);
            return Positioned(
              top: y, left: 12, right: 12,
              child: Container(
                height: 2,
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: [Colors.transparent, _kOrange.withOpacity(0.9), Colors.transparent]),
                  borderRadius: BorderRadius.circular(2),
                  boxShadow: [BoxShadow(color: _kOrange.withOpacity(0.5), blurRadius: 8, spreadRadius: 1)],
                ),
              ),
            );
          },
        ),
      ]),
    );
  }

  Widget _corner(double size, double thick,
      {bool topLeft = false, bool topRight = false, bool bottomLeft = false, bool bottomRight = false}) {
    return SizedBox(width: size, height: size,
      child: CustomPaint(painter: _CornerPainter(
        topLeft: topLeft, topRight: topRight, bottomLeft: bottomLeft, bottomRight: bottomRight,
        color: _kOrange, thickness: thick, radius: 6,
      )),
    );
  }

  // ── Item found screen ─────────────────────────────────────────

  Widget _buildItemFoundScreen() {
    return Scaffold(
      backgroundColor: _kBg,
      body: SafeArea(child: Column(children: [
        // Header
        Container(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
          decoration: BoxDecoration(
            color: _kCard,
            border: Border(bottom: BorderSide(color: Colors.green.withOpacity(0.15))),
          ),
          child: Row(children: [
            GestureDetector(
              onTap: () => Navigator.pop(context, _scannedCode),
              child: Container(padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: Colors.white.withOpacity(0.06), borderRadius: BorderRadius.circular(10)),
                child: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 22)),
            ),
            const SizedBox(width: 14),
            Container(padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.green.withOpacity(0.12), borderRadius: BorderRadius.circular(12)),
              child: Icon(Icons.check_circle_rounded, color: Colors.green.shade400, size: 24)),
            const SizedBox(width: 10),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('ITEM FOUND', style: GoogleFonts.outfit(color: Colors.green.shade400, fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 1)),
              Text('Scan verified', style: GoogleFonts.outfit(color: Colors.white38, fontSize: 12)),
            ]),
            const Spacer(),
            Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(color: _kOrange.withOpacity(0.12), borderRadius: BorderRadius.circular(20), border: Border.all(color: _kOrange.withOpacity(0.3))),
              child: Text('# ${_scannedCode ?? ''}', style: GoogleFonts.outfit(color: _kOrange, fontSize: 13, fontWeight: FontWeight.w700))),
          ]),
        ),

        // Details list
        Expanded(child: SlideTransition(
          position: _slideAnim,
          child: FadeTransition(
            opacity: _slideCtrl,
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(children: [
                _scanTile('ITEM NAME', _scannedItem!['ITEM_NAME'] ?? '', Icons.inventory_2_outlined, const Color(0xFF42A5F5)),
                _scanTile('DESCRIPTION', _scannedItem!['DESCRIBE'] ?? '', Icons.description_outlined, const Color(0xFFAB47BC)),
                Row(children: [
                  Expanded(flex: 2, child: _scanTile('QUANTITY', _scannedItem!['QUANTITY'] ?? '', Icons.numbers_rounded, const Color(0xFF26C6DA))),
                  const SizedBox(width: 10),
                  Expanded(flex: 3, child: _scanTile('RATE*(100-DISC_B)/100', DatabaseService.calculateDiscountedRate(_scannedItem!['RATE'], _scannedItem!['DISC_B']), Icons.currency_rupee_rounded, _kOrange)),
                ]),
              ]),
            ),
          ),
        )),

        // Done button
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          child: SizedBox(width: double.infinity, height: 56,
            child: GestureDetector(
              onTap: () => Navigator.pop(context, _scannedCode),
              child: Container(
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [Colors.green, Color(0xFF43A047)], begin: Alignment.topLeft, end: Alignment.bottomRight),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [BoxShadow(color: Colors.green.withOpacity(0.35), blurRadius: 14, offset: const Offset(0, 5))],
                ),
                child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.check_rounded, color: Colors.white, size: 22),
                  const SizedBox(width: 8),
                  Text('DONE', style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16, letterSpacing: 1)),
                ]),
              ),
            )),
        ),
      ])),
    );
  }

  // ── Item NOT found screen ──────────────────────────────────────

  Widget _buildItemNotFoundScreen() {
    return Scaffold(
      backgroundColor: _kBg,
      body: SafeArea(child: Column(children: [
        // Header bar
        Container(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
          color: _kCard,
          child: Row(children: [
            GestureDetector(
              onTap: () => Navigator.pop(context, _scannedCode),
              child: Container(padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: Colors.white.withOpacity(0.06), borderRadius: BorderRadius.circular(10)),
                child: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 22)),
            ),
            const SizedBox(width: 12),
            Text('Item Not Found', style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 18)),
          ]),
        ),

        Expanded(child: Center(child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            // Warning icon
            Container(width: 80, height: 80,
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: [_kOrange.withOpacity(0.2), _kRed.withOpacity(0.2)]),
                shape: BoxShape.circle,
                border: Border.all(color: _kOrange.withOpacity(0.4), width: 2),
              ),
              child: const Icon(Icons.search_off_rounded, color: _kOrange, size: 42),
            ),
            const SizedBox(height: 24),
            Text('ITEM NOT FOUND', style: GoogleFonts.outfit(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: 1)),
            const SizedBox(height: 10),
            Container(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(color: _kCard, borderRadius: BorderRadius.circular(12), border: Border.all(color: _kOrange.withOpacity(0.25))),
              child: Text('I.CODE: ${_scannedCode ?? ''}', style: GoogleFonts.outfit(color: _kOrange, fontSize: 18, fontWeight: FontWeight.w700))),
            const SizedBox(height: 10),
            Text('No matching item found in local database.', textAlign: TextAlign.center, style: GoogleFonts.outfit(color: Colors.white38, fontSize: 13)),
            const SizedBox(height: 36),
            SizedBox(width: double.infinity, height: 54,
              child: GestureDetector(
                onTap: _restartScanner,
                child: Container(
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: [_kOrange, _kRed], begin: Alignment.topLeft, end: Alignment.bottomRight),
                    borderRadius: BorderRadius.circular(15),
                    boxShadow: [BoxShadow(color: _kOrange.withOpacity(0.35), blurRadius: 14, offset: const Offset(0, 5))],
                  ),
                  child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    const Icon(Icons.qr_code_scanner_rounded, color: Colors.white, size: 22),
                    const SizedBox(width: 8),
                    Text('SCAN AGAIN', style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15, letterSpacing: 1)),
                  ]),
                ),
              )),
            const SizedBox(height: 12),
            SizedBox(width: double.infinity, height: 50,
              child: OutlinedButton(
                onPressed: () => Navigator.pop(context, _scannedCode),
                style: OutlinedButton.styleFrom(side: BorderSide(color: Colors.white.withOpacity(0.2)), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)), foregroundColor: Colors.white60),
                child: Text('CLOSE', style: GoogleFonts.outfit(fontWeight: FontWeight.w700, fontSize: 15)),
              )),
          ]),
        ))),
      ])),
    );
  }

  Widget _scanTile(String label, dynamic value, IconData icon, Color accent) {
    final text = value?.toString().trim() ?? '';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(color: _kCard, borderRadius: BorderRadius.circular(13), border: Border.all(color: Colors.white.withOpacity(0.06))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(width: 36, height: 36, decoration: BoxDecoration(color: accent.withOpacity(0.12), borderRadius: BorderRadius.circular(10)), child: Icon(icon, color: accent, size: 19)),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: GoogleFonts.outfit(fontSize: 10, color: Colors.white30, fontWeight: FontWeight.w700, letterSpacing: 0.3), maxLines: 2, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 2),
          Text(text.isEmpty ? '\u2014' : text, style: GoogleFonts.outfit(fontSize: 15, color: Colors.white, fontWeight: FontWeight.w600)),
        ])),
      ]),
    );
  }
}

// ── Corner bracket painter ──────────────────────────────────────

class _CornerPainter extends CustomPainter {
  final bool topLeft, topRight, bottomLeft, bottomRight;
  final Color color;
  final double thickness;
  final double radius;

  const _CornerPainter({
    this.topLeft = false, this.topRight = false,
    this.bottomLeft = false, this.bottomRight = false,
    required this.color, required this.thickness, required this.radius,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = thickness
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final double len = size.width * 0.75;

    if (topLeft) {
      canvas.drawLine(Offset(0, len), Offset(0, radius), paint);
      canvas.drawArc(Rect.fromLTWH(0, 0, radius * 2, radius * 2), 3.14159, 3.14159 / 2, false, paint);
      canvas.drawLine(Offset(radius, 0), Offset(len, 0), paint);
    }
    if (topRight) {
      canvas.drawLine(Offset(size.width, len), Offset(size.width, radius), paint);
      canvas.drawArc(Rect.fromLTWH(size.width - radius * 2, 0, radius * 2, radius * 2), -3.14159 / 2, -(3.14159 / 2), false, paint);
      canvas.drawLine(Offset(size.width - radius, 0), Offset(size.width - len, 0), paint);
    }
    if (bottomLeft) {
      canvas.drawLine(Offset(0, size.height - len), Offset(0, size.height - radius), paint);
      canvas.drawArc(Rect.fromLTWH(0, size.height - radius * 2, radius * 2, radius * 2), 3.14159 / 2, 3.14159 / 2, false, paint);
      canvas.drawLine(Offset(radius, size.height), Offset(len, size.height), paint);
    }
    if (bottomRight) {
      canvas.drawLine(Offset(size.width, size.height - len), Offset(size.width, size.height - radius), paint);
      canvas.drawArc(Rect.fromLTWH(size.width - radius * 2, size.height - radius * 2, radius * 2, radius * 2), 0, 3.14159 / 2, false, paint);
      canvas.drawLine(Offset(size.width - radius, size.height), Offset(size.width - len, size.height), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _CornerPainter old) =>
      old.color != color || old.thickness != thickness;
}
