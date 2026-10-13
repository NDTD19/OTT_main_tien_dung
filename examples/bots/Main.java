import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Sample Java bot. Requires only JDK 21; reads one JSON object per line. */
public class Main {
    private static final Pattern MOVE = Pattern.compile(
        "\\\"from\\\"\\s*:\\s*\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]\\s*,\\s*\\\"to\\\"\\s*:\\s*\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]"
    );

    public static void main(String[] args) throws Exception {
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = input.readLine()) != null) {
            Matcher move = MOVE.matcher(line);
            if (move.find()) {
                System.out.printf("{\"from\":[%s,%s],\"to\":[%s,%s]}%n",
                    move.group(1), move.group(2), move.group(3), move.group(4));
            } else {
                System.out.println("{\"type\":\"pass\"}");
            }
            System.out.flush();
        }
    }
}
