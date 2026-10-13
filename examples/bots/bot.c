#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Lightweight C11 example: select the first legal action from the observation. */
int main(void) {
    static char line[65536];
    while (fgets(line, sizeof(line), stdin)) {
        char *from = strstr(line, "\"from\"");
        char *to = from ? strstr(from, "\"to\"") : NULL;
        int r1, c1, r2, c2;
        if (from && to && (from = strchr(from, '[')) && (to = strchr(to, '[')) &&
            sscanf(from, "[ %d , %d ]", &r1, &c1) == 2 &&
            sscanf(to, "[ %d , %d ]", &r2, &c2) == 2) {
            printf("{\"from\":[%d,%d],\"to\":[%d,%d]}\n", r1, c1, r2, c2);
        } else {
            puts("{\"type\":\"pass\"}");
        }
        fflush(stdout);
    }
    return 0;
}
