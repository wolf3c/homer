// Copy into an isolated gateway controller package; never uses live billing data.
package controller

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The focused gateway tests need the same embedded translations as its startup.
func init() {
	if err := i18n.Init(); err != nil {
		panic(err)
	}
}

func TestHomerMembershipWebSocketWarmupBilling(t *testing.T) {
	for _, tc := range []struct {
		name, expression string
		warmupQuota      int
	}{
		{"token pricing", `tier("input", p * 2)`, 0},
		{"request pricing", `tier("request", fixed(0.002))`, 1000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := newResponsesWSBillingTest(t, tc.expression, func(ws *websocket.Conn, _ *http.Request) {
				for index := 0; index < 2; index++ {
					_, body, err := ws.ReadMessage()
					if !assert.NoError(t, err) {
						return
					}
					var request map[string]any
					if !assert.NoError(t, common.Unmarshal(body, &request)) {
						return
					}
					if index == 0 {
						assert.Equal(t, false, request["generate"])
					} else {
						assert.Equal(t, "warmup", request["previous_response_id"])
						// A duplicate warmup terminal cannot settle the active generation.
						if !assert.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"id":"warmup","status":"completed","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}`))) {
							return
						}
					}
					id, input, output := "warmup", 0, 0
					if index == 1 {
						id, input, output = "generation", 1000, 10
					}
					terminal := fmt.Sprintf(`{"type":"response.completed","response":{"id":%q,"status":"completed","output":[],"usage":{"input_tokens":%d,"output_tokens":%d,"total_tokens":%d}}}`, id, input, output, input+output)
					if !assert.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte(terminal))) {
						return
					}
				}
				_, _, _ = ws.ReadMessage()
			})
			for index, payload := range []string{
				`{"type":"response.create","model":"ws-billing","generate":false,"input":[]}`,
				`{"type":"response.create","model":"ws-billing","previous_response_id":"warmup","input":[{"role":"user","content":"synthetic generation"}]}`,
			} {
				require.NoError(t, fixture.client.SetReadDeadline(time.Now().Add(3*time.Second)))
				require.NoError(t, fixture.client.WriteMessage(websocket.TextMessage, []byte(payload)))
				event := readResponsesWSTestEvent(t, fixture.client)
				require.Equal(t, "response.completed", event["type"])
				assert.Equal(t, []string{"warmup", "generation"}[index], event["response"].(map[string]any)["id"])
			}
			fixture.closeAndWait(t)
			assertResponsesWSAccounting(t, fixture, []int{tc.warmupQuota, 1000})
			assert.Equal(t, int32(1), fixture.connections.Load())
		})
	}
}
