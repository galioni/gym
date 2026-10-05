/// Which video links the editors accept: YouTube watch, shorts and youtu.be links (the web editor's pattern; pinned by
/// contract/editors.fixtures.json, which reads the pattern out of the web source).
library;

final _youtube = RegExp(r'^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}');

bool isValidYouTubeUrl(String url) => _youtube.hasMatch(url);
