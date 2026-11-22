using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace AgyClaudeStudio
{
    public static class MiniJson
    {
        public static object Parse(string json)
        {
            if (json == null) throw new ArgumentNullException("json");
            int idx = 0;
            object val = ParseValue(json, ref idx);
            SkipWhitespace(json, ref idx);
            if (idx != json.Length)
            {
                throw new FormatException("Unexpected trailing character at index " + idx);
            }
            return val;
        }

        public static Dictionary<string, object> ParseObject(string json)
        {
            object val = Parse(json);
            Dictionary<string, object> dict = val as Dictionary<string, object>;
            if (dict == null) throw new FormatException("Expected JSON object");
            return dict;
        }

        public static List<object> ParseArray(string json)
        {
            object val = Parse(json);
            List<object> list = val as List<object>;
            if (list == null) throw new FormatException("Expected JSON array");
            return list;
        }

        public static string Stringify(object value, bool pretty)
        {
            StringBuilder sb = new StringBuilder(256);
            WriteValue(sb, value, pretty, 0);
            return sb.ToString();
        }

        public static string StringifyString(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder(s.Length + 16);
            WriteString(sb, s);
            return sb.ToString();
        }

        private static void SkipWhitespace(string s, ref int idx)
        {
            while (idx < s.Length)
            {
                char c = s[idx];
                if (c == ' ' || c == '\t' || c == '\r' || c == '\n') idx++;
                else break;
            }
        }

        private static object ParseValue(string s, ref int idx)
        {
            SkipWhitespace(s, ref idx);
            if (idx >= s.Length) throw new FormatException("Unexpected end of JSON");
            char c = s[idx];
            if (c == '{') return ParseObjectInternal(s, ref idx);
            if (c == '[') return ParseArrayInternal(s, ref idx);
            if (c == '"') return ParseString(s, ref idx);
            if (c == 't') { ExpectLiteral(s, ref idx, "true"); return true; }
            if (c == 'f') { ExpectLiteral(s, ref idx, "false"); return false; }
            if (c == 'n') { ExpectLiteral(s, ref idx, "null"); return null; }
            if (c == '-' || (c >= '0' && c <= '9')) return ParseNumber(s, ref idx);
            throw new FormatException("Unexpected character '" + c + "' at index " + idx);
        }

        private static void ExpectLiteral(string s, ref int idx, string lit)
        {
            if (idx + lit.Length > s.Length || string.CompareOrdinal(s, idx, lit, 0, lit.Length) != 0)
            {
                throw new FormatException("Expected '" + lit + "' at index " + idx);
            }
            idx += lit.Length;
        }

        private static Dictionary<string, object> ParseObjectInternal(string s, ref int idx)
        {
            idx++; // '{'
            Dictionary<string, object> dict = new Dictionary<string, object>(StringComparer.Ordinal);
            SkipWhitespace(s, ref idx);
            if (idx < s.Length && s[idx] == '}')
            {
                idx++;
                return dict;
            }
            while (true)
            {
                SkipWhitespace(s, ref idx);
                if (idx >= s.Length || s[idx] != '"') throw new FormatException("Expected string key at index " + idx);
                string key = ParseString(s, ref idx);
                SkipWhitespace(s, ref idx);
                if (idx >= s.Length || s[idx] != ':') throw new FormatException("Expected ':' at index " + idx);
                idx++;
                object val = ParseValue(s, ref idx);
                dict[key] = val;
                SkipWhitespace(s, ref idx);
                if (idx >= s.Length) throw new FormatException("Unterminated JSON object");
                if (s[idx] == '}') { idx++; return dict; }
                if (s[idx] != ',') throw new FormatException("Expected ',' or '}' at index " + idx);
                idx++;
            }
        }

        private static List<object> ParseArrayInternal(string s, ref int idx)
        {
            idx++; // '['
            List<object> list = new List<object>();
            SkipWhitespace(s, ref idx);
            if (idx < s.Length && s[idx] == ']')
            {
                idx++;
                return list;
            }
            while (true)
            {
                object val = ParseValue(s, ref idx);
                list.Add(val);
                SkipWhitespace(s, ref idx);
                if (idx >= s.Length) throw new FormatException("Unterminated JSON array");
                if (s[idx] == ']') { idx++; return list; }
                if (s[idx] != ',') throw new FormatException("Expected ',' or ']' at index " + idx);
                idx++;
            }
        }

        private static string ParseString(string s, ref int idx)
        {
            idx++; // '"'
            StringBuilder sb = new StringBuilder();
            while (idx < s.Length)
            {
                char c = s[idx++];
                if (c == '"') return sb.ToString();
                if (c == '\\')
                {
                    if (idx >= s.Length) throw new FormatException("Unterminated escape sequence");
                    char esc = s[idx++];
                    switch (esc)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (idx + 4 > s.Length) throw new FormatException("Invalid unicode escape");
                            int code = int.Parse(s.Substring(idx, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                            idx += 4;
                            sb.Append((char)code);
                            break;
                        default:
                            throw new FormatException("Invalid escape '\\" + esc + "'");
                    }
                }
                else
                {
                    sb.Append(c);
                }
            }
            throw new FormatException("Unterminated JSON string");
        }

        private static object ParseNumber(string s, ref int idx)
        {
            int start = idx;
            bool isFloat = false;
            if (s[idx] == '-') idx++;
            while (idx < s.Length && s[idx] >= '0' && s[idx] <= '9') idx++;
            if (idx < s.Length && s[idx] == '.')
            {
                isFloat = true;
                idx++;
                while (idx < s.Length && s[idx] >= '0' && s[idx] <= '9') idx++;
            }
            if (idx < s.Length && (s[idx] == 'e' || s[idx] == 'E'))
            {
                isFloat = true;
                idx++;
                if (idx < s.Length && (s[idx] == '+' || s[idx] == '-')) idx++;
                while (idx < s.Length && s[idx] >= '0' && s[idx] <= '9') idx++;
            }
            string raw = s.Substring(start, idx - start);
            if (!isFloat)
            {
                long lv;
                if (long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out lv)) return lv;
            }
            double dv;
            if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out dv)) return dv;
            throw new FormatException("Invalid JSON number: " + raw);
        }

        private static void WriteValue(StringBuilder sb, object value, bool pretty, int depth)
        {
            if (value == null)
            {
                sb.Append("null");
                return;
            }
            string str = value as string;
            if (str != null)
            {
                WriteString(sb, str);
                return;
            }
            if (value is bool)
            {
                sb.Append((bool)value ? "true" : "false");
                return;
            }
            if (value is int || value is long || value is short || value is byte)
            {
                sb.Append(Convert.ToInt64(value, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture));
                return;
            }
            if (value is double || value is float || value is decimal)
            {
                double d = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (double.IsNaN(d) || double.IsInfinity(d)) sb.Append("null");
                else sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                return;
            }
            IDictionary dict = value as IDictionary;
            if (dict != null)
            {
                WriteObject(sb, dict, pretty, depth);
                return;
            }
            IEnumerable arr = value as IEnumerable;
            if (arr != null)
            {
                WriteArray(sb, arr, pretty, depth);
                return;
            }
            WriteString(sb, value.ToString());
        }

        private static void WriteObject(StringBuilder sb, IDictionary dict, bool pretty, int depth)
        {
            sb.Append('{');
            bool first = true;
            foreach (DictionaryEntry entry in dict)
            {
                if (!first) sb.Append(',');
                first = false;
                if (pretty)
                {
                    sb.Append('\n');
                    sb.Append(' ', (depth + 1) * 2);
                }
                WriteString(sb, Convert.ToString(entry.Key, CultureInfo.InvariantCulture));
                sb.Append(pretty ? ": " : ":");
                WriteValue(sb, entry.Value, pretty, depth + 1);
            }
            if (!first && pretty)
            {
                sb.Append('\n');
                sb.Append(' ', depth * 2);
            }
            sb.Append('}');
        }

        private static void WriteArray(StringBuilder sb, IEnumerable arr, bool pretty, int depth)
        {
            sb.Append('[');
            bool first = true;
            foreach (object item in arr)
            {
                if (!first) sb.Append(',');
                first = false;
                if (pretty)
                {
                    sb.Append('\n');
                    sb.Append(' ', (depth + 1) * 2);
                }
                WriteValue(sb, item, pretty, depth + 1);
            }
            if (!first && pretty)
            {
                sb.Append('\n');
                sb.Append(' ', depth * 2);
            }
            sb.Append(']');
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\u2028': sb.Append("\\u2028"); break;
                    case '\u2029': sb.Append("\\u2029"); break;
                    default:
                        if (c < 0x20)
                        {
                            sb.Append("\\u");
                            sb.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
