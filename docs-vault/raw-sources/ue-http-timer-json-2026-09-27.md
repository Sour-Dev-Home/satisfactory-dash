Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/ (Unreal Engine 5.6 documentation)
Captured: 2026-09-27T05:39:34Z
Method: curl of each page, then HTML to text (tags removed). Version: the documentation for Unreal Engine 5.6 (application_version=5.6); the SML docs name 5.6.1 with Coffee Stain's changes, and Coffee Stain's custom engine can differ from these public API pages.
Excerpts only: Only quoted excerpts are committed. The source is third-party documentation without a licence that permits redistributing it (the SML Documentation repository has no licence; Epic's API pages are Epic's), so the full text stays verifiable at the pinned URL and a complete local copy is kept outside this repository (the owner's Documents folder, dash-captures/mod-g0-full/, not committed).
Item: 5 of 9: for the game's UE version, the HTTP module reference (request, response), the timer or ticker reference, and JSON serialisation.
FINDINGS:
  - HTTP: FHttpModule creates requests (CreateRequest) and has `bEnableHttp` ('Toggles http requests') and `AllowedDomains` ('List of domains that can be accessed. If Empty then no filtering is applied'); IHttpRequest has SetURL, SetVerb, SetHeader, SetContentAsString, SetTimeout, ProcessRequest and OnProcessRequestComplete. These are the calls a mod spike (claims C2, C3) would use, as documented; nothing here says they work on a dedicated server.
  - Timers: FTimerManager::SetTimer (game-thread timers) and FTSTicker ('Thread-safe ticker class. Fires delegates after a delay').
  - JSON: FJsonSerializer (Deserialize and Serialize overloads over TJsonReader/TJsonWriter) and FJsonObjectConverter (UStruct to and from JSON).
  - Pages captured in full locally, quoted here only in part: FHttpModule, IHttpRequest, IHttpResponse, IHttpBase, FHttpManager, FTimerManager, FTSTicker, FJsonSerializer, FJsonObjectConverter.
NOT FOUND (recorded, not guessed):
  - TLS / certificate verification behaviour of the HTTP module: none of the captured HTTP pages (FHttpModule, IHttpRequest, IHttpResponse, IHttpBase, FHttpManager) mentions certificates, TLS, SSL or verification. [NEEDS VERIFICATION before claim C3.]
  - Pages at .../Runtime/Json/Serialization/FJsonSerializer, .../Runtime/Json/Dom/FJsonObject, .../Runtime/Core/Containers/FTSTicker: empty shells for 5.6 (17 characters of text); the pages with content are Runtime/Json/FJsonSerializer and Runtime/Core/FTSTicker.
Convention: each excerpt sits between a BEGIN line and an END line written by the capture (they are not part of the source); the text between them is the source, unedited, with "[... skipped ...]" lines between separate ranges.
---

##### BEGIN UE 5.6 API: Runtime/HTTP/FHttpModule, lines 1-16, 45-51 #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/HTTP/FHttpModule?application_version=5.6
# Note: An excerpt: the ranges are joined by "[... skipped ...]" lines that are not part of the source. Text extracted from the page's HTML (tags removed, whitespace collapsed); the line numbers refer to that extracted text, kept in the local full copy.
FHttpModule | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FHttpModule
FHttpModule
Module for Http request implementations Use FHttpFactory to create a new Http request
On this page Navigation
API > API/Runtime > API/Runtime/HTTP
Module for Http request implementations Use FHttpFactory to create a new Http request
Name
FHttpModule
Type
class
Header File
/Engine/Source/Runtime/Online/HTTP/Public/HttpModule.h
Include Path
#include "HttpModule.h"
[... skipped ...]
AllowedDomains
TArray < FString >
List of domains that can be accessed. If Empty then no filtering is applied
HttpModule.h
bEnableHttp
bool
Toggles http requests
##### END UE 5.6 API: Runtime/HTTP/FHttpModule, lines 1-16, 45-51 #####

##### BEGIN UE 5.6 API: Runtime/HTTP/IHttpRequest, lines 1-16, 94-96, 189-198 #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/HTTP/IHttpRequest?application_version=5.6
# Note: An excerpt: the ranges are joined by "[... skipped ...]" lines that are not part of the source. Text extracted from the page's HTML (tags removed, whitespace collapsed); the line numbers refer to that extracted text, kept in the local full copy.
IHttpRequest | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
IHttpRequest
IHttpRequest
Interface for Http requests (created using FHttpFactory)
On this page Navigation
API > API/Runtime > API/Runtime/HTTP
Interface for Http requests (created using FHttpFactory)
Name
IHttpRequest
Type
class
Header File
/Engine/Source/Runtime/Online/HTTP/Public/Interfaces/IHttpRequest.h
Include Path
#include "Interfaces/IHttpRequest.h"
[... skipped ...]
bool ProcessRequest ()
Called to begin processing the request.
Interfaces/IHttpRequest.h
[... skipped ...]
void SetURL
(
const FString& URL
)
Sets the URL for the request Eg.
Interfaces/IHttpRequest.h
void SetVerb
(
const FString& Verb
)
##### END UE 5.6 API: Runtime/HTTP/IHttpRequest, lines 1-16, 94-96, 189-198 #####

##### BEGIN UE 5.6 API: Runtime/Engine/FTimerManager, lines 1-8, 179-187 #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/FTimerManager?application_version=5.6
# Note: An excerpt: the ranges are joined by "[... skipped ...]" lines that are not part of the source. Text extracted from the page's HTML (tags removed, whitespace collapsed); the line numbers refer to that extracted text, kept in the local full copy.
FTimerManager | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FTimerManager
FTimerManager
Class to globally manage timers.
On this page Navigation
API > API/Runtime > API/Runtime/Engine
Class to globally manage timers.
[... skipped ...]
void SetTimer
(
FTimerHandle & InOutHandle,
FTimerDelegate const& InDelegate,
float InRate,
const FTimerManagerTimerParameters & InTimerParameters
)
Version that takes any generic delegate.
TimerManager.h
##### END UE 5.6 API: Runtime/Engine/FTimerManager, lines 1-8, 179-187 #####

##### BEGIN UE 5.6 API: Runtime/Core/FTSTicker, lines 1-8 #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Core/FTSTicker?application_version=5.6
# Note: An excerpt: the ranges are joined by "[... skipped ...]" lines that are not part of the source. Text extracted from the page's HTML (tags removed, whitespace collapsed); the line numbers refer to that extracted text, kept in the local full copy.
FTSTicker | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FTSTicker
FTSTicker
Thread-safe ticker class. Fires delegates after a delay.
On this page Navigation
API > API/Runtime > API/Runtime/Core
Thread-safe ticker class. Fires delegates after a delay.
##### END UE 5.6 API: Runtime/Core/FTSTicker, lines 1-8 #####

##### BEGIN UE 5.6 API: Runtime/Json/FJsonSerializer, lines 1-16 #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Json/FJsonSerializer?application_version=5.6
# Note: An excerpt: the ranges are joined by "[... skipped ...]" lines that are not part of the source. Text extracted from the page's HTML (tags removed, whitespace collapsed); the line numbers refer to that extracted text, kept in the local full copy.
FJsonSerializer | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FJsonSerializer
FJsonSerializer
On this page Navigation
API > API/Runtime > API/Runtime/Json
Name
FJsonSerializer
Type
class
Header File
/Engine/Source/Runtime/Json/Public/Serialization/JsonSerializer.h
Include Path
#include "Serialization/JsonSerializer.h"
Syntax
class FJsonSerializer
##### END UE 5.6 API: Runtime/Json/FJsonSerializer, lines 1-16 #####
