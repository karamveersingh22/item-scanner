import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'screens/icode_scanner_screen.dart';
import 'screens/login_screen.dart';
import 'services/auth_service.dart';
import 'services/cloud_sync_service.dart';
import 'services/database_service.dart';

const _kOrange = Color(0xFFFF8C00);
const _kRed = Color(0xFFE53935);
const _kBg = Color(0xFF0D0D1A);
const _kCard = Color(0xFF14142B);

void main() {
  runApp(const ItemScannerApp());
}

class ItemScannerApp extends StatelessWidget {
  const ItemScannerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ITEM MASTER',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: _kBg,
        cardColor: _kCard,
        colorScheme: const ColorScheme.dark(
          primary: _kOrange,
          secondary: _kRed,
          surface: _kCard,
        ),
      ),
      home: const AuthGate(),
    );
  }
}

/// Authentication gate:
/// Checks if an authenticated company session exists.
/// If yes, goes to HomePage; otherwise, shows LoginScreen.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  final AuthService _authService = AuthService();
  bool _checking = true;

  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  Future<void> _checkAuth() async {
    await _authService.restoreSession();
    if (!mounted) return;
    setState(() => _checking = false);
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return Scaffold(
        backgroundColor: _kBg,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  gradient: const LinearGradient(
                    colors: [_kOrange, _kRed],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                child: const Icon(Icons.qr_code_scanner_rounded, color: Colors.white, size: 40),
              ),
              const SizedBox(height: 24),
              const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(color: _kOrange, strokeWidth: 2.5),
              ),
            ],
          ),
        ),
      );
    }

    if (_authService.isAuthenticated) {
      return const HomePage();
    } else {
      return const LoginScreen();
    }
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with TickerProviderStateMixin {
  final databaseService = DatabaseService();
  final codeController = TextEditingController();
  final FocusNode _focusNode = FocusNode();
  final CloudSyncService _cloudSyncService = CloudSyncService();

  Map<String, dynamic>? item;
  bool loading = true;
  bool syncingDatabase = false;
  String status = 'Initializing...';
  int itemCount = 0;
  String lastSyncTime = '';
  Timer? _periodicSyncTimer;

  late AnimationController _slideCtrl;
  late AnimationController _pulseCtrl;
  late Animation<Offset> _slideAnim;
  late Animation<double> _pulseAnim;

  @override
  void initState() {
    super.initState();
    _slideCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 500));
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))
      ..repeat(reverse: true);
    _slideAnim = Tween<Offset>(begin: const Offset(0, 0.25), end: Offset.zero)
        .animate(CurvedAnimation(parent: _slideCtrl, curve: Curves.easeOutCubic));
    _pulseAnim = Tween<double>(begin: 1.0, end: 1.06)
        .animate(CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut));

    _cloudSyncService.stateNotifier.addListener(_onSyncStateChanged);

    _loadLastSyncTime().then((_) {
      initializeDatabase().then((_) {
        if (mounted) {
          _startBackgroundSync();
          // Periodic automatic background check every 15 minutes (non-blocking)
          _periodicSyncTimer = Timer.periodic(
            const Duration(minutes: 15),
            (_) {
              if (mounted) _startBackgroundSync();
            },
          );
        }
      });
    });
  }

  @override
  void dispose() {
    _periodicSyncTimer?.cancel();
    _cloudSyncService.stateNotifier.removeListener(_onSyncStateChanged);
    _slideCtrl.dispose();
    _pulseCtrl.dispose();
    _focusNode.dispose();
    codeController.dispose();
    super.dispose();
  }

  Future<void> _loadLastSyncTime() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('last_sync_time') ?? '';
    if (mounted && saved.isNotEmpty) setState(() => lastSyncTime = saved);
  }

  void _onSyncStateChanged() {
    if (!mounted) return;
    final state = _cloudSyncService.state;
    setState(() {
      syncingDatabase = state.isSyncing;
      status = state.message;
      if (state.isSuccess) {
        databaseService.getItemCount().then((cnt) {
          if (mounted) setState(() => itemCount = cnt);
        });
        _loadLastSyncTime();
      }
    });
  }

  /// Non-blocking background sync on launch.
  /// The local SQLite database is already initialized and scanning is instantly available.
  Future<void> _startBackgroundSync() async {
    await _cloudSyncService.synchronize(force: false);
  }

  /// Manual synchronization triggered from the UI.
  Future<void> syncDatabase() async {
    if (_cloudSyncService.state.isSyncing) return;
    await _cloudSyncService.synchronize(force: true);
  }

  Future<void> initializeDatabase() async {
    try {
      final count = await databaseService.getItemCount();
      if (!mounted) return;
      setState(() { itemCount = count; loading = false; status = '$count items ready \u2713'; });
    } catch (e) {
      if (!mounted) return;
      setState(() { loading = false; status = 'Database error:\n$e'; });
    }
  }

  Future<void> scanICode() async {
    final result = await Navigator.push(context, MaterialPageRoute(builder: (_) => const ICodeScannerScreen()));
    if (!mounted) return;
    if (result != null && result is String) {
      codeController.text = result;
      await searchItem();
    }
  }

  Future<void> searchItem() async {
    final code = codeController.text.trim();
    if (code.isEmpty) {
      setState(() { item = null; status = 'Please enter an I_CODE'; });
      return;
    }
    final stopwatch = Stopwatch()..start();
    final result = await databaseService.findItem(code);
    stopwatch.stop();
    if (!mounted) return;
    setState(() {
      item = result;
      if (result == null) {
        status = 'Item not found: $code\nSearch: ${stopwatch.elapsedMicroseconds} \u00b5s';
        _slideCtrl.reset();
      } else {
        status = 'Item found \u2713\nSearch: ${stopwatch.elapsedMicroseconds} \u00b5s';
        _slideCtrl.forward(from: 0);
      }
    });
  }

  bool get _isError =>
      status.toLowerCase().contains('error') ||
      status.toLowerCase().contains('failed') ||
      status.toLowerCase().contains('not found');

  bool get _isSuccess => status.contains('\u2713');

  @override
  Widget build(BuildContext context) {
    if (loading) return _buildLoader();
    return Scaffold(
      backgroundColor: _kBg,
      body: CustomScrollView(slivers: [
        _buildAppBar(),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
          sliver: SliverList(delegate: SliverChildListDelegate([
            _buildStatusCard(),
            const SizedBox(height: 14),
            _buildSearchBox(),
            const SizedBox(height: 12),
            _buildButtons(),
            if (item != null) ...[const SizedBox(height: 20), _buildItemCard()]
            else if (_isError && status.toLowerCase().contains('not found')) ...[const SizedBox(height: 16), _buildNotFoundBanner()],
            const SizedBox(height: 30),
          ])),
        ),
      ]),
    );
  }

  Widget _buildLoader() => Scaffold(
    backgroundColor: _kBg,
    body: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      _brandIcon(72, 20, 42),
      const SizedBox(height: 32),
      const SizedBox(width: 26, height: 26, child: CircularProgressIndicator(color: _kOrange, strokeWidth: 3)),
      const SizedBox(height: 18),
      Text(status, textAlign: TextAlign.center, style: GoogleFonts.outfit(color: Colors.white54, fontSize: 14)),
    ])),
  );

  Widget _buildAppBar() => SliverAppBar(
    expandedHeight: 190,
    pinned: true,
    backgroundColor: _kCard,
    elevation: 0,
    actions: [
      IconButton(
        icon: const Icon(Icons.account_circle_outlined, color: Colors.white70),
        tooltip: 'Company Account',
        onPressed: _showCompanyAccountSheet,
      ),
      const SizedBox(width: 6),
    ],
    flexibleSpace: FlexibleSpaceBar(
      centerTitle: true,
      title: Text('ITEM MASTER', style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16, letterSpacing: 2)),
      background: Container(
        decoration: const BoxDecoration(gradient: LinearGradient(colors: [Color(0xFF0D0D1A), Color(0xFF1A0A2E), Color(0xFF0D0D1A)], begin: Alignment.topLeft, end: Alignment.bottomRight)),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          const SizedBox(height: 36),
          ScaleTransition(scale: _pulseAnim, child: _brandIcon(72, 20, 40)),
          const SizedBox(height: 10),
          const SizedBox(height: 6),
          if (lastSyncTime.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: Colors.green.withOpacity(0.12), borderRadius: BorderRadius.circular(20), border: Border.all(color: Colors.green.withOpacity(0.25))),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Container(width: 6, height: 6, decoration: const BoxDecoration(color: Colors.greenAccent, shape: BoxShape.circle)),
                const SizedBox(width: 5),
                Text('Synced $lastSyncTime', style: GoogleFonts.outfit(color: Colors.green.shade400, fontSize: 11, fontWeight: FontWeight.w600)),
              ]),
            ),
        ]),
      ),
    ),
  );

  void _showCompanyAccountSheet() {
    final company = AuthService().currentCompany;
    showModalBottomSheet(
      context: context,
      backgroundColor: _kCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: _kOrange.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.business_rounded, color: _kOrange, size: 24),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            company?.companyName.isNotEmpty == true ? company!.companyName : 'Company Account',
                            style: GoogleFonts.outfit(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            company?.username.isNotEmpty == true ? '@${company!.username}' : '@company',
                            style: GoogleFonts.outfit(
                              color: Colors.white54,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.green.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: Colors.green.withOpacity(0.3)),
                      ),
                      child: Text(
                        company?.status ?? 'Active',
                        style: GoogleFonts.outfit(
                          color: Colors.greenAccent,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                const Divider(color: Colors.white12),
                const SizedBox(height: 12),
                _buildAccountRow('Company ID', company?.id.isNotEmpty == true ? company!.id : '-'),
                const SizedBox(height: 10),
                _buildAccountRow('Username', company?.username.isNotEmpty == true ? company!.username : '-'),
                const SizedBox(height: 10),
                _buildAccountRow('Account Status', company?.status ?? 'Active'),
                const SizedBox(height: 10),
                _buildAccountRow(
                  'Last Sync',
                  lastSyncTime.isNotEmpty ? lastSyncTime : 'Not connected yet',
                ),
                const SizedBox(height: 24),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _kRed,
                    side: BorderSide(color: _kRed.withOpacity(0.5)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  icon: const Icon(Icons.logout_rounded, size: 18),
                  label: Text(
                    'Sign Out',
                    style: GoogleFonts.outfit(fontSize: 14, fontWeight: FontWeight.w600),
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    _confirmLogout();
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildAccountRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: GoogleFonts.outfit(color: Colors.white54, fontSize: 13)),
        const SizedBox(width: 8),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.outfit(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }

  Future<void> _confirmLogout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _kCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Text('Sign Out', style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.w700)),
        content: Text(
          'Are you sure you want to sign out of this company?\n\nLocal item search data will remain available for the next session.',
          style: GoogleFonts.outfit(color: Colors.white70, fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Cancel', style: GoogleFonts.outfit(color: Colors.white54)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Sign Out', style: GoogleFonts.outfit(color: _kRed, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await AuthService().logout();
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (route) => false,
      );
    }
  }

  Widget _buildStatusCard() {
    final iconBg = syncingDatabase ? _kOrange.withOpacity(0.12) : _isError ? Colors.red.withOpacity(0.1) : Colors.green.withOpacity(0.1);
    final iconColor = syncingDatabase ? _kOrange : _isError ? Colors.redAccent : Colors.greenAccent;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: _kCard, borderRadius: BorderRadius.circular(18), border: Border.all(color: Colors.white.withOpacity(0.06))),
      child: Row(children: [
        Container(width: 52, height: 52, decoration: BoxDecoration(color: iconBg, borderRadius: BorderRadius.circular(14)),
          child: syncingDatabase
            ? Padding(padding: const EdgeInsets.all(13), child: CircularProgressIndicator(strokeWidth: 2.5, color: _kOrange))
            : Icon(Icons.storage_rounded, color: iconColor, size: 26)),
        const SizedBox(width: 14),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('$itemCount', style: GoogleFonts.outfit(fontSize: 26, fontWeight: FontWeight.w800, color: Colors.white, height: 1)),
            const SizedBox(width: 5),
            Padding(padding: const EdgeInsets.only(bottom: 2), child: Text('items loaded', style: GoogleFonts.outfit(fontSize: 13, color: Colors.white38))),
          ]),
          const SizedBox(height: 3),
          Text(status, maxLines: 2, overflow: TextOverflow.ellipsis,
            style: GoogleFonts.outfit(fontSize: 12, fontWeight: FontWeight.w500,
              color: _isError ? Colors.red.shade400 : _isSuccess ? Colors.green.shade400 : Colors.white38)),
          if (_isError)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: GestureDetector(
                onTap: syncingDatabase ? null : syncDatabase,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.refresh_rounded, color: _kOrange, size: 14),
                    const SizedBox(width: 4),
                    Text(
                      'Tap to retry sync',
                      style: GoogleFonts.outfit(
                        fontSize: 11,
                        color: _kOrange,
                        fontWeight: FontWeight.w600,
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ])),
      ]),
    );
  }

  Widget _buildSearchBox() => Container(
    decoration: BoxDecoration(color: _kCard, borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.white.withOpacity(0.08))),
    child: TextField(
      controller: codeController,
      focusNode: _focusNode,
      autofocus: true,
      keyboardType: TextInputType.number,
      textInputAction: TextInputAction.search,
      style: GoogleFonts.outfit(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600),
      onChanged: (v) {
        final code = v.trim();
        if (code.length >= 3) { searchItem(); }
        else { setState(() { item = null; status = '$itemCount items ready \u2713'; }); }
      },
      onSubmitted: (_) => searchItem(),
      decoration: InputDecoration(
        hintText: 'Enter I.CODE  (e.g. 40515)',
        hintStyle: GoogleFonts.outfit(color: Colors.white24, fontSize: 15),
        prefixIcon: const Icon(Icons.search_rounded, color: _kOrange, size: 26),
        suffixIcon: codeController.text.isNotEmpty
          ? IconButton(icon: const Icon(Icons.close_rounded, color: Colors.white38, size: 20), onPressed: () { codeController.clear(); setState(() { item = null; status = '$itemCount items ready \u2713'; }); })
          : null,
        border: InputBorder.none,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
      ),
    ),
  );

  Widget _buildButtons() => Column(children: [
    Row(children: [
      Expanded(child: _GradButton(
        label: syncingDatabase ? 'SYNCING...' : 'SYNC DATABASE',
        icon: syncingDatabase
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
          : const Icon(Icons.cloud_download_rounded, color: Colors.white, size: 20),
        gradient: const LinearGradient(colors: [_kOrange, _kRed], begin: Alignment.topLeft, end: Alignment.bottomRight),
        onTap: syncingDatabase ? null : syncDatabase,
      )),
      const SizedBox(width: 10),
      Expanded(child: _GradButton(
        label: 'READ I.CODE',
        icon: const Icon(Icons.document_scanner_rounded, color: Colors.white, size: 20),
        gradient: const LinearGradient(colors: [Color(0xFF1565C0), Color(0xFF29B6F6)], begin: Alignment.topLeft, end: Alignment.bottomRight),
        onTap: scanICode,
      )),
    ]),
    const SizedBox(height: 10),
    SizedBox(width: double.infinity, height: 48,
      child: OutlinedButton.icon(
        onPressed: searchItem,
        style: OutlinedButton.styleFrom(side: BorderSide(color: _kOrange.withOpacity(0.45)), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)), foregroundColor: _kOrange),
        icon: const Icon(Icons.manage_search_rounded, size: 20),
        label: Text('SEARCH ITEM', style: GoogleFonts.outfit(fontWeight: FontWeight.w700, fontSize: 14)),
      )),
  ]);

  Widget _buildNotFoundBanner() => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: Colors.red.withOpacity(0.07), borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.red.withOpacity(0.2))),
    child: Row(children: [
      Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: Colors.red.withOpacity(0.12), borderRadius: BorderRadius.circular(10)), child: const Icon(Icons.search_off_rounded, color: Colors.redAccent, size: 24)),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Item Not Found', style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
        Text('No match for "${codeController.text.trim()}"', style: GoogleFonts.outfit(color: Colors.white38, fontSize: 12)),
      ])),
    ]),
  );

  Widget _buildItemCard() => SlideTransition(
    position: _slideAnim,
    child: FadeTransition(
      opacity: _slideCtrl,
      child: Container(
        decoration: BoxDecoration(color: _kCard, borderRadius: BorderRadius.circular(20), border: Border.all(color: Colors.green.withOpacity(0.22)),
          boxShadow: [BoxShadow(color: Colors.green.withOpacity(0.07), blurRadius: 24, spreadRadius: 2)]),
        child: Column(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
            decoration: BoxDecoration(color: Colors.green.withOpacity(0.08), borderRadius: const BorderRadius.vertical(top: Radius.circular(20)), border: Border(bottom: BorderSide(color: Colors.green.withOpacity(0.12)))),
            child: Row(children: [
              Container(padding: const EdgeInsets.all(6), decoration: BoxDecoration(color: Colors.green.withOpacity(0.15), borderRadius: BorderRadius.circular(9)), child: Icon(Icons.check_circle_rounded, color: Colors.green.shade400, size: 20)),
              const SizedBox(width: 10),
              Text('ITEM FOUND', style: GoogleFonts.outfit(color: Colors.green.shade400, fontSize: 15, fontWeight: FontWeight.w800, letterSpacing: 1)),
              const Spacer(),
              Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: _kOrange.withOpacity(0.12), borderRadius: BorderRadius.circular(20), border: Border.all(color: _kOrange.withOpacity(0.3))),
                child: Text('# ${item!['I_CODE'] ?? ''}', style: GoogleFonts.outfit(color: _kOrange, fontSize: 13, fontWeight: FontWeight.w700))),
            ]),
          ),
          Padding(padding: const EdgeInsets.all(14), child: Column(children: [
            _tile('ITEM NAME', item!['ITEM_NAME'], Icons.inventory_2_outlined, const Color(0xFF42A5F5)),
            _tile('DESCRIPTION', item!['DESCRIBE'], Icons.description_outlined, const Color(0xFFAB47BC)),
            Row(children: [
              Expanded(flex: 2, child: _tile('QUANTITY', item!['QUANTITY'], Icons.numbers_rounded, const Color(0xFF26C6DA))),
              const SizedBox(width: 10),
              Expanded(flex: 3, child: _tile('RATE*(100-DISC_B)/100', DatabaseService.calculateDiscountedRate(item!['RATE'], item!['DISC_B']), Icons.currency_rupee_rounded, _kOrange)),
            ]),
          ])),
        ]),
      ),
    ),
  );

  Widget _tile(String label, dynamic value, IconData icon, Color accent) {
    final text = value?.toString().trim() ?? '';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(color: _kBg, borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.white.withOpacity(0.05))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(width: 34, height: 34, decoration: BoxDecoration(color: accent.withOpacity(0.12), borderRadius: BorderRadius.circular(9)), child: Icon(icon, color: accent, size: 18)),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: GoogleFonts.outfit(fontSize: 10, color: Colors.white30, fontWeight: FontWeight.w700, letterSpacing: 0.3), maxLines: 2, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 2),
          Text(text.isEmpty ? '\u2014' : text, style: GoogleFonts.outfit(fontSize: 15, color: Colors.white, fontWeight: FontWeight.w600)),
        ])),
      ]),
    );
  }

  Widget _brandIcon(double size, double radius, double iconSize) => Container(
    width: size, height: size,
    decoration: BoxDecoration(
      gradient: const LinearGradient(colors: [_kOrange, _kRed], begin: Alignment.topLeft, end: Alignment.bottomRight),
      borderRadius: BorderRadius.circular(radius),
      boxShadow: [BoxShadow(color: _kOrange.withOpacity(0.45), blurRadius: 22, spreadRadius: 2)]),
    child: Icon(Icons.inventory_2_rounded, color: Colors.white, size: iconSize),
  );
}

class _GradButton extends StatefulWidget {
  final String label;
  final Widget icon;
  final LinearGradient gradient;
  final VoidCallback? onTap;
  const _GradButton({required this.label, required this.icon, required this.gradient, required this.onTap});
  @override
  State<_GradButton> createState() => _GradButtonState();
}

class _GradButtonState extends State<_GradButton> {
  bool _pressed = false;
  @override
  Widget build(BuildContext context) {
    final disabled = widget.onTap == null;
    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) { setState(() => _pressed = false); widget.onTap?.call(); },
      onTapCancel: () => setState(() => _pressed = false),
      child: AnimatedScale(
        scale: _pressed ? 0.96 : 1.0,
        duration: const Duration(milliseconds: 100),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          height: 56,
          decoration: BoxDecoration(
            gradient: disabled ? LinearGradient(colors: [Colors.grey.shade800, Colors.grey.shade700]) : widget.gradient,
            borderRadius: BorderRadius.circular(14),
            boxShadow: disabled ? [] : [BoxShadow(color: widget.gradient.colors.first.withOpacity(0.38), blurRadius: 14, offset: const Offset(0, 5))],
          ),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            widget.icon,
            const SizedBox(width: 7),
            Flexible(child: Text(widget.label, overflow: TextOverflow.ellipsis, style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13))),
          ]),
        ),
      ),
    );
  }
}
